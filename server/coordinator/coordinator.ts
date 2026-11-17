/**
 * Phase 2.3.1: Central Runtime Resource Coordinator
 * 
 * Provides deterministic, centralized admission control, strict serialization,
 * FIFO queueing, ownership enforcement, idempotent release, and fail-closed recovery.
 */

import crypto from 'node:crypto';
import { ResourceCompatibilityPolicy } from './policy.js';
import type { IPersistenceAdapter } from './persistence.js';
import {
  DefaultProcessLivenessChecker,
  ResourceCoordinatorError,
  normalizeResidency,
  type CoordinatorSnapshot,
  type CoordinatorState,
  type IResourceProviderLifecycle,
  type ProcessLivenessChecker,
  type ProviderResidencyState,
  type ProviderStatus,
  type RecoveryOptions,
  type RecoveryResult,
  type ReleaseResult,
  type Reservation,
  type ReservationRecord,
  type ReservationRequestOptions,
  type ReservationStatus,
  type ResourceType,
} from './types.js';

export const PROCESS_STARTED_AT = Math.floor(Date.now() - process.uptime() * 1000);
export const PROCESS_INSTANCE_ID = `proc_${process.pid}_${PROCESS_STARTED_AT}_${crypto.randomUUID()}`;

interface QueuedRequest {
  readonly id: string;
  readonly resourceType: ResourceType;
  readonly ownerId: string;
  readonly requestedAt: number;
  readonly pid?: number;
  readonly timeoutMs?: number;
  readonly metadata?: Record<string, unknown>;
  cancelled?: boolean;
  timer?: NodeJS.Timeout;
  resolve: (res: Reservation) => void;
  reject: (err: Error) => void;
}

export interface ResourceCoordinatorOptions {
  persistence?: IPersistenceAdapter;
  processLiveness?: ProcessLivenessChecker;
  providers?: Map<ResourceType, IResourceProviderLifecycle>;
  now?: () => number;
}

export class ResourceCoordinator {
  public readonly processInstanceId: string = PROCESS_INSTANCE_ID;
  public readonly processStartedAt: number = PROCESS_STARTED_AT;

  private coordinatorState: CoordinatorState = 'IDLE';
  private activeReservation: ReservationRecord | null = null;
  private readonly waitingQueue: QueuedRequest[] = [];
  private readonly releasedReservations = new Map<string, ReservationRecord>();

  private readonly persistence?: IPersistenceAdapter;
  private readonly processLiveness: ProcessLivenessChecker;
  private readonly providers: Map<ResourceType, IResourceProviderLifecycle>;
  private readonly now: () => number;

  private isProcessingQueue = false;
  private queueProcessingScheduled = false;
  private readonly inProgressTargetedRecoveries = new Map<string, Promise<RecoveryResult>>();
  private inProgressGlobalRecoveryPromise: Promise<RecoveryResult> | null = null;
  private recoveryExecutionChain: Promise<void> = Promise.resolve();

  private metrics = {
    totalAcquired: 0,
    totalReleased: 0,
    totalCancelled: 0,
    totalTimedOut: 0,
    totalFailed: 0,
    totalRecoveries: 0,
  };

  constructor(options: ResourceCoordinatorOptions = {}) {
    this.persistence = options.persistence;
    this.processLiveness = options.processLiveness ?? new DefaultProcessLivenessChecker();
    this.providers = options.providers ?? new Map();
    this.now = options.now ?? (() => Date.now());

    this.initializeFromPersistence();
  }

  /**
   * Initializes coordinator state from persisted SQLite storage if available.
   * If an active or unresolved reservation exists, coordinator enters RECOVERY_REQUIRED fail-closed.
   */
  private initializeFromPersistence(): void {
    if (!this.persistence) return;

    const unresolved = this.persistence.getActiveOrUnresolved();
    if (unresolved.length > 0) {
      // Pick the earliest unresolved reservation
      const first = unresolved[0];
      this.activeReservation = first;
      this.coordinatorState = 'RECOVERY_REQUIRED';
    } else {
      this.activeReservation = null;
      this.coordinatorState = 'IDLE';
    }
  }

  /**
   * Current coordinator state.
   */
  public getState(): CoordinatorState {
    return this.coordinatorState;
  }

  /**
   * Request and acquire admission for a resource workload.
   * If compatible and unreserved, granted immediately. Otherwise enqueued FIFO.
   */
  public async acquire(
    resourceType: ResourceType,
    ownerId: string,
    options: ReservationRequestOptions = {}
  ): Promise<Reservation> {
    if (this.coordinatorState === 'SHUTDOWN') {
      throw new ResourceCoordinatorError('SHUTDOWN', 'ResourceCoordinator has been shut down');
    }

    if (
      this.coordinatorState === 'RECOVERY_REQUIRED' ||
      this.coordinatorState === 'RECOVERY_INSPECTING' ||
      this.coordinatorState === 'RECOVERY_UNLOADING' ||
      this.coordinatorState === 'RECOVERY_VERIFYING'
    ) {
      throw new ResourceCoordinatorError(
        'RECOVERY_REQUIRED',
        'Coordinator is in fail-closed RECOVERY_REQUIRED state; admissions locked'
      );
    }

    if (!ResourceCompatibilityPolicy.isValidResourceType(resourceType)) {
      throw new ResourceCoordinatorError('INVALID_RESOURCE', `Invalid resource type: ${resourceType}`);
    }

    if (!ownerId || typeof ownerId !== 'string' || ownerId.trim().length === 0) {
      throw new ResourceCoordinatorError('WRONG_OWNER', 'Owner ID must be a non-empty string');
    }

    const reservationId =
      options.customReservationId ?? `resv_${this.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Prevent duplicate active acquisition by the same owner for the same active reservation
    if (this.activeReservation && this.activeReservation.id === reservationId) {
      throw new ResourceCoordinatorError(
        'ALREADY_ACTIVE',
        `Reservation ${reservationId} is already actively held`
      );
    }

    // Check if duplicate reservationId already queued
    if (this.waitingQueue.some((q) => q.id === reservationId)) {
      throw new ResourceCoordinatorError(
        'ALREADY_REQUESTED',
        `Reservation ${reservationId} is already queued`
      );
    }

    const currentTime = this.now();
    const activeTypes = this.activeReservation ? [this.activeReservation.resourceType] : [];
    const isPreparationRequired = resourceType === 'SDXL' && this.providers.has('LLM');

    const canAdmitNow =
      !isPreparationRequired &&
      this.waitingQueue.length === 0 &&
      this.coordinatorState === 'IDLE' &&
      ResourceCompatibilityPolicy.canAdmit(resourceType, activeTypes);

    if (canAdmitNow) {
      return this.grantAdmission(reservationId, resourceType, ownerId, options, currentTime);
    }

    // Enqueue FIFO
    const queuePromise = new Promise<Reservation>((resolve, reject) => {
      const queuedItem: QueuedRequest = {
        id: reservationId,
        resourceType,
        ownerId,
        requestedAt: currentTime,
        pid: options.pid,
        timeoutMs: options.timeoutMs,
        metadata: options.metadata,
        resolve,
        reject,
      };

      if (options.timeoutMs && options.timeoutMs > 0) {
        queuedItem.timer = setTimeout(() => {
          this.handleAdmissionTimeout(reservationId);
        }, options.timeoutMs);
      }

      this.waitingQueue.push(queuedItem);
    });

    // Trigger queue processing asynchronously (e.g. for SDXL preparation when coordinator is IDLE)
    if (this.coordinatorState === 'IDLE' && this.waitingQueue.length === 1) {
      void this.processQueue();
    }

    return queuePromise;
  }

  /**
   * Synchronously transitions to LOADING then ACTIVE and commits persistence.
   */
  private grantAdmission(
    id: string,
    resourceType: ResourceType,
    ownerId: string,
    options: ReservationRequestOptions,
    timestamp: number
  ): Reservation {
    // Transition IDLE -> LOADING -> ACTIVE
    this.coordinatorState = 'LOADING';

    const record: ReservationRecord = {
      id,
      resourceType,
      ownerId,
      status: 'ACTIVE',
      pid: options.pid ?? process.pid,
      acquiredAt: timestamp,
      lastHeartbeatAt: timestamp,
      metadata: {
        ...options.metadata,
        processInstanceId: (options.metadata?.processInstanceId as string) ?? this.processInstanceId,
        processStartedAt: (options.metadata?.processStartedAt as number) ?? this.processStartedAt,
        reservationCreatedAt: timestamp,
      },
    };

    if (this.persistence) {
      try {
        this.persistence.createReservation(record);
      } catch (err) {
        this.coordinatorState = 'FAILED';
        this.metrics.totalFailed++;
        throw err;
      }
    }

    this.activeReservation = record;
    this.coordinatorState = 'ACTIVE';
    this.metrics.totalAcquired++;

    return this.createReservationHandle(record);
  }

  /**
   * Release an active reservation.
   * Enforces ownership, idempotency, provider unloads, and triggers FIFO dequeue.
   */
  public async release(reservationId: string, ownerId: string): Promise<ReleaseResult> {
    if (!ownerId || typeof ownerId !== 'string' || ownerId.trim().length === 0) {
      throw new ResourceCoordinatorError('WRONG_OWNER', 'Owner ID must be a non-empty string');
    }

    // Check if duplicate release for an already-released reservation by the same owner
    const previouslyReleased = this.releasedReservations.get(reservationId);
    if (previouslyReleased) {
      if (previouslyReleased.ownerId !== ownerId) {
        throw new ResourceCoordinatorError(
          'WRONG_OWNER',
          `Cannot release reservation ${reservationId}: owner mismatch`
        );
      }
      return { success: true, alreadyReleased: true, reservationId };
    }

    // Check active reservation
    if (!this.activeReservation || this.activeReservation.id !== reservationId) {
      // Check persisted state if available
      if (this.persistence) {
        const persisted = this.persistence.getReservation(reservationId);
        if (persisted && persisted.status === 'RELEASED') {
          if (persisted.ownerId !== ownerId) {
            throw new ResourceCoordinatorError(
              'WRONG_OWNER',
              `Cannot release reservation ${reservationId}: owner mismatch`
            );
          }
          return { success: true, alreadyReleased: true, reservationId };
        }
      }

      throw new ResourceCoordinatorError(
        'RESERVATION_NOT_FOUND',
        `No active or recognized reservation found with ID: ${reservationId}`
      );
    }

    // Verify ownership
    if (this.activeReservation.ownerId !== ownerId) {
      throw new ResourceCoordinatorError(
        'WRONG_OWNER',
        `Cannot release reservation ${reservationId}: owner mismatch`
      );
    }

    const currentRes = this.activeReservation;
    const releaseTimestamp = this.now();

    // Transition: ACTIVE -> DRAINING -> UNLOADING -> VERIFYING_RELEASE
    this.coordinatorState = 'DRAINING';
    currentRes.status = 'DRAINING';

    const provider = this.providers.get(currentRes.resourceType);
    if (provider) {
      try {
        await provider.prepareForRelease(reservationId);
        this.coordinatorState = 'UNLOADING';
        currentRes.status = 'UNLOADING';
        await provider.release(reservationId);

        this.coordinatorState = 'VERIFYING_RELEASE';
        currentRes.status = 'VERIFYING_RELEASE';
        const isVerified = await provider.verifyReleased(reservationId);

        if (!isVerified) {
          this.coordinatorState = 'RECOVERY_REQUIRED';
          currentRes.status = 'RECOVERY_REQUIRED';
          currentRes.failureReason = 'Provider failed release verification';
          this.persistence?.updateStatus(reservationId, 'RECOVERY_REQUIRED', currentRes.failureReason);
          this.metrics.totalFailed++;
          throw new ResourceCoordinatorError(
            'RELEASE_FAILED',
            `Provider failed to verify release of resource ${currentRes.resourceType}`
          );
        }
      } catch (err: any) {
        this.coordinatorState = 'RECOVERY_REQUIRED';
        currentRes.status = 'RECOVERY_REQUIRED';
        currentRes.failureReason = err?.message || 'Provider unload exception';
        this.persistence?.updateStatus(reservationId, 'RECOVERY_REQUIRED', currentRes.failureReason);
        this.metrics.totalFailed++;
        throw err instanceof ResourceCoordinatorError
          ? err
          : new ResourceCoordinatorError('RELEASE_FAILED', `Release failed: ${err?.message || err}`);
      }
    }

    // Mark successfully released
    currentRes.status = 'RELEASED';
    currentRes.releasedAt = releaseTimestamp;
    this.persistence?.updateStatus(reservationId, 'RELEASED', undefined, releaseTimestamp);

    this.releasedReservations.set(reservationId, currentRes);
    this.activeReservation = null;
    this.metrics.totalReleased++;

    // Dequeue next in FIFO order
    this.processQueue();

    return { success: true, alreadyReleased: false, reservationId };
  }

  /**
   * Processes the waiting queue in strict FIFO order.
   * Handles pre-admission preparation for memory-intensive resources (e.g. SDXL).
   * Robust against queue cancellation, async interleaving, and ensures no orphan grants.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      this.queueProcessingScheduled = true;
      return;
    }
    this.isProcessingQueue = true;

    try {
      while (true) {
        this.queueProcessingScheduled = false;

        if (
          this.coordinatorState === 'SHUTDOWN' ||
          this.coordinatorState === 'RECOVERY_REQUIRED' ||
          this.coordinatorState === 'PREPARING_ADMISSION' ||
          this.coordinatorState === 'RECOVERY_INSPECTING' ||
          this.coordinatorState === 'RECOVERY_UNLOADING' ||
          this.coordinatorState === 'RECOVERY_VERIFYING'
        ) {
          break;
        }

        if (this.waitingQueue.length === 0) {
          if (this.coordinatorState !== 'ACTIVE' && this.coordinatorState !== 'LOADING') {
            this.coordinatorState = 'IDLE';
          }
          break;
        }

        // Clean up any pre-cancelled items at queue head
        if (this.waitingQueue[0].cancelled) {
          this.waitingQueue.shift();
          continue;
        }

        // Check head of queue (FIFO fairness - index 0 is first)
        const candidate = this.waitingQueue[0];
        const activeTypes = this.activeReservation ? [this.activeReservation.resourceType] : [];

        if (!ResourceCompatibilityPolicy.canAdmit(candidate.resourceType, activeTypes)) {
          if (!this.activeReservation) {
            this.coordinatorState = 'IDLE';
          }
          break;
        }

        // Pre-admission preparation for memory-intensive resources (e.g. SDXL requires resident LLM unload)
        if (candidate.resourceType === 'SDXL' && this.providers.has('LLM')) {
          const llmProvider = this.providers.get('LLM')!;
          this.coordinatorState = 'PREPARING_ADMISSION';

          let status: ProviderStatus;
          try {
            status = await llmProvider.getStatus();
          } catch (err: any) {
            this.coordinatorState = 'RECOVERY_REQUIRED';
            const idx = this.waitingQueue.indexOf(candidate);
            if (idx !== -1) this.waitingQueue.splice(idx, 1);
            if (candidate.timer) clearTimeout(candidate.timer);
            candidate.reject(
              new ResourceCoordinatorError(
                'PREPARATION_FAILED',
                `Provider status query failed during preparation: ${err?.message || err}`
              )
            );
            break;
          }

          // Check if candidate was cancelled during getStatus()
          if (candidate.cancelled || !this.waitingQueue.includes(candidate)) {
            this.coordinatorState = 'IDLE';
            continue;
          }

          // Strict runtime residency normalization (Workstream B / Phase 2.3.2.6)
          const residency: ProviderResidencyState = normalizeResidency(status?.residency);

          if (residency !== 'RESIDENT' && residency !== 'NOT_RESIDENT') {
            // UNKNOWN or unexpected -> FAIL CLOSED
            this.coordinatorState = 'RECOVERY_REQUIRED';
            const idx = this.waitingQueue.indexOf(candidate);
            if (idx !== -1) this.waitingQueue.splice(idx, 1);
            if (candidate.timer) clearTimeout(candidate.timer);
            candidate.reject(
              new ResourceCoordinatorError(
                'PREPARATION_FAILED',
                'Ollama provider residency status is UNKNOWN; cannot safely admit SDXL'
              )
            );
            break;
          }

          if (residency === 'RESIDENT') {
            try {
              if (llmProvider.prepareForAdmission) {
                const prepared = await llmProvider.prepareForAdmission('SDXL');
                if (!prepared) {
                  throw new Error('LLM provider prepareForAdmission returned false');
                }
              } else {
                await llmProvider.release('system:pre-admission-unload');
                const verified = await llmProvider.verifyReleased('system:pre-admission-unload');
                if (!verified) {
                  throw new Error('Failed to verify release after pre-admission unload');
                }
              }
            } catch (err: any) {
              this.coordinatorState = 'RECOVERY_REQUIRED';
              const idx = this.waitingQueue.indexOf(candidate);
              if (idx !== -1) this.waitingQueue.splice(idx, 1);
              if (candidate.timer) clearTimeout(candidate.timer);
              candidate.reject(
                new ResourceCoordinatorError(
                  'PREPARATION_FAILED',
                  `Failed to unload resident LLM model before SDXL admission: ${err?.message || err}`
                )
              );
              break;
            }

            // Check if candidate was cancelled during unload
            if (candidate.cancelled || !this.waitingQueue.includes(candidate)) {
              this.coordinatorState = 'IDLE';
              continue;
            }
          }

          // Preparation completed successfully! Model is verified NOT_RESIDENT.
          this.coordinatorState = 'IDLE';
        }

        // Final identity and cancellation check before dequeuing
        const finalIdx = this.waitingQueue.indexOf(candidate);
        if (finalIdx !== 0 || candidate.cancelled) {
          if (finalIdx !== -1 && candidate.cancelled) {
            this.waitingQueue.splice(finalIdx, 1);
          }
          this.coordinatorState = 'IDLE';
          continue;
        }

        // Dequeue candidate and grant admission
        this.waitingQueue.splice(finalIdx, 1);
        if (candidate.timer) {
          clearTimeout(candidate.timer);
        }

        try {
          const reservation = this.grantAdmission(
            candidate.id,
            candidate.resourceType,
            candidate.ownerId,
            { pid: candidate.pid, metadata: candidate.metadata },
            this.now()
          );
          candidate.resolve(reservation);
        } catch (err: any) {
          candidate.reject(err);
        }
        break;
      }
    } finally {
      this.isProcessingQueue = false;
      if (this.queueProcessingScheduled && this.waitingQueue.length > 0 && this.coordinatorState === 'IDLE') {
        void this.processQueue();
      }
    }
  }

  /**
   * Cancel a waiting request in the queue.
   */
  public cancel(reservationId: string, ownerId: string): boolean {
    const item = this.waitingQueue.find((q) => q.id === reservationId);
    if (!item) {
      return false;
    }

    if (item.ownerId !== ownerId) {
      throw new ResourceCoordinatorError(
        'WRONG_OWNER',
        `Cannot cancel reservation request ${reservationId}: owner mismatch`
      );
    }

    item.cancelled = true;
    const index = this.waitingQueue.indexOf(item);
    if (index !== -1) {
      this.waitingQueue.splice(index, 1);
    }
    if (item.timer) {
      clearTimeout(item.timer);
    }

    this.metrics.totalCancelled++;
    item.reject(
      new ResourceCoordinatorError('CANCELLED', 'Request was cancelled before admission')
    );

    if (this.coordinatorState === 'IDLE' && this.waitingQueue.length > 0) {
      void this.processQueue();
    }

    return true;
  }

  /**
   * Internal admission timeout handler.
   */
  private handleAdmissionTimeout(reservationId: string): void {
    const index = this.waitingQueue.findIndex((q) => q.id === reservationId);
    if (index === -1) return;

    const item = this.waitingQueue.splice(index, 1)[0];
    if (item.timer) {
      clearTimeout(item.timer);
    }

    this.metrics.totalTimedOut++;
    item.reject(
      new ResourceCoordinatorError('TIMEOUT', 'Request timed out waiting for admission')
    );
  }

  /**
   * Heartbeat to record liveness of an active reservation.
   * Does NOT auto-release on stale heartbeat.
   */
  public heartbeat(reservationId: string, ownerId: string): void {
    if (!this.activeReservation || this.activeReservation.id !== reservationId) {
      throw new ResourceCoordinatorError('RESERVATION_NOT_FOUND', 'Active reservation not found');
    }

    if (this.activeReservation.ownerId !== ownerId) {
      throw new ResourceCoordinatorError('WRONG_OWNER', 'Owner mismatch on heartbeat');
    }

    const ts = this.now();
    this.activeReservation.lastHeartbeatAt = ts;
    this.persistence?.updateHeartbeat(reservationId, ts);
  }

  /**
   * Transitions an active or persisted reservation to RECOVERY_REQUIRED fail-closed.
   * Locks all future admissions until explicit verified recovery occurs.
   */
  public markRecoveryRequired(reservationId: string, reason: string): void {
    this.coordinatorState = 'RECOVERY_REQUIRED';
    if (this.activeReservation && this.activeReservation.id === reservationId) {
      this.activeReservation.status = 'RECOVERY_REQUIRED';
      this.activeReservation.failureReason = reason;
    }
    this.persistence?.updateStatus(reservationId, 'RECOVERY_REQUIRED', reason);
    this.metrics.totalFailed++;
  }

  /**
   * Returns the current active reservation record, if any.
   */
  public getActiveReservation(): ReservationRecord | null {
    return this.activeReservation;
  }

  /**
   * Returns the number of requests currently queued in FIFO order.
   */
  public getQueueLength(): number {
    return this.waitingQueue.length;
  }

  /**
   * Recovers unresolved reservations under fail-closed verification rules (Workstream C, D, E, F).
   * Supports:
   * - Single-flight serialization (AUDIT-2323-04)
   * - Recovery authorization boundaries (AUDIT-2323-06)
   * - Strict residency verification (AUDIT-2323-02)
   * - Process-instance identity verification (AUDIT-2323-03)
   * - Deterministic multi-reservation reconciliation (AUDIT-2323-05)
   */
  /**
   * Schedules a recovery task sequentially on the global recovery execution chain.
   * Ensures provider unloads, state mutations, and SQLite transitions never overlap unsafely,
   * while allowing concurrent callers to join or queue deterministically.
   */
  private enqueueRecoveryTask<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.recoveryExecutionChain = this.recoveryExecutionChain
        .catch(() => {}) // Prevent failure in one recovery task from poisoning subsequent ones
        .then(async () => {
          try {
            const result = await task();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        });
    });
  }

  /**
   * Recovers from crashed, terminated, or inconsistent resource states.
   *
   * Workstream A: Explicit authorization required. Missing identity never implies system privilege.
   * Workstream C: Per-reservation single-flight execution combined with serialized recovery chain.
   */
  public async recover(
    reservationId?: string,
    options?: RecoveryOptions
  ): Promise<RecoveryResult> {
    const isSystem = options?.isSystemPrivileged === true;
    const callerId = options?.callerId;

    // Workstream A: Missing caller identity must never imply system privilege.
    if (!isSystem && !callerId) {
      throw new ResourceCoordinatorError(
        'WRONG_OWNER',
        'Recovery requires an authenticated caller ID or explicit system authority'
      );
    }

    if (!reservationId) {
      // Global multi-reservation recovery requires explicit system authority.
      if (!isSystem) {
        throw new ResourceCoordinatorError(
          'WRONG_OWNER',
          'Non-privileged caller cannot perform global multi-reservation recovery'
        );
      }

      // Single-flight deduplication for global recovery
      if (this.inProgressGlobalRecoveryPromise) {
        return this.inProgressGlobalRecoveryPromise;
      }

      const promise = this.enqueueRecoveryTask(() =>
        this.recoverAllUnresolved(callerId, isSystem)
      );

      this.inProgressGlobalRecoveryPromise = promise;
      try {
        return await promise;
      } finally {
        if (this.inProgressGlobalRecoveryPromise === promise) {
          this.inProgressGlobalRecoveryPromise = null;
        }
      }
    }

    // Targeted single-reservation recovery
    // Verify caller authorization upfront BEFORE joining or scheduling in-flight operations
    let record: ReservationRecord | null =
      this.activeReservation?.id === reservationId ? this.activeReservation : null;
    if (!record && this.persistence) {
      record = this.persistence.getReservation(reservationId);
    }
    if (!record) {
      record = this.releasedReservations.get(reservationId) ?? null;
    }

    if (!isSystem) {
      if (!record) {
        throw new ResourceCoordinatorError(
          'RESERVATION_NOT_FOUND',
          `Reservation ${reservationId} not found`
        );
      }
      if (record.ownerId !== callerId) {
        throw new ResourceCoordinatorError(
          'WRONG_OWNER',
          `Caller ${callerId} is not authorized to recover reservation ${reservationId} owned by ${record.ownerId}`
        );
      }
    }

    // Caller is authorized. Deduplicate if a recovery for this reservationId is already in flight.
    const existingPromise = this.inProgressTargetedRecoveries.get(reservationId);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = this.enqueueRecoveryTask(() =>
      this.recoverSingleReservation(reservationId, callerId, isSystem)
    );

    this.inProgressTargetedRecoveries.set(reservationId, promise);
    try {
      return await promise;
    } finally {
      if (this.inProgressTargetedRecoveries.get(reservationId) === promise) {
        this.inProgressTargetedRecoveries.delete(reservationId);
      }
    }
  }

  private async recoverSingleReservation(
    targetId: string,
    callerId?: string,
    isSystem = false
  ): Promise<RecoveryResult> {
    let record: ReservationRecord | null =
      this.activeReservation?.id === targetId ? this.activeReservation : null;
    if (!record && this.persistence) {
      record = this.persistence.getReservation(targetId);
    }
    if (!record) {
      record = this.releasedReservations.get(targetId) ?? null;
    }

    if (!record) {
      if (this.coordinatorState === 'RECOVERY_REQUIRED') {
        const remaining = this.persistence?.getActiveOrUnresolved() ?? [];
        if (remaining.length === 0) {
          this.coordinatorState = 'IDLE';
          void this.processQueue();
          return { recovered: true, targetId, lifecycleTrail: ['RECOVERY_REQUIRED', 'IDLE'] };
        } else {
          this.activeReservation = remaining[0];
          return { recovered: false, reason: 'UNRESOLVED_RESERVATIONS_REMAIN', targetId: remaining[0].id };
        }
      }
      return { recovered: true, reason: 'NO_ACTIVE_RESERVATION', lifecycleTrail: ['NO_ACTIVE_RESERVATION'] };
    }

    // Workstream A: Authorization check
    if (callerId && !isSystem && record.ownerId !== callerId) {
      throw new ResourceCoordinatorError(
        'WRONG_OWNER',
        `Caller ${callerId} is not authorized to recover reservation ${targetId} owned by ${record.ownerId}`
      );
    }

    if (record.status === 'RELEASED') {
      return {
        recovered: true,
        targetId,
        reason: 'ALREADY_RELEASED',
        lifecycleTrail: ['ALREADY_RELEASED'],
      };
    }

    const lifecycleTrail: string[] = ['RECOVERY_INSPECTING'];
    this.coordinatorState = 'RECOVERY_INSPECTING';

    // 1. Process liveness & instance identity check (Workstream C / AUDIT-2323-03 / Workstream D)
    if (record.pid) {
      const isCurrentProcess =
        record.pid === process.pid &&
        record.metadata?.processInstanceId === this.processInstanceId;

      if (!isCurrentProcess) {
        const isAlive = this.processLiveness.isProcessAlive(record.pid);
        if (isAlive === 'UNKNOWN') {
          this.coordinatorState = 'RECOVERY_REQUIRED';
          record.status = 'RECOVERY_REQUIRED';
          this.persistence?.updateStatus(targetId, 'RECOVERY_REQUIRED', 'Unverified process state');
          return { recovered: false, reason: 'UNVERIFIED_PROCESS_STATE', targetId, lifecycleTrail };
        }
        if (isAlive === true) {
          // FAIL CLOSED: External process is still actively running!
          this.coordinatorState = 'RECOVERY_REQUIRED';
          record.status = 'RECOVERY_REQUIRED';
          this.persistence?.updateStatus(targetId, 'RECOVERY_REQUIRED', 'Process still alive');
          return { recovered: false, reason: 'PROCESS_STILL_ALIVE', targetId, lifecycleTrail };
        }
      }
    } else {
      // Missing PID -> FAIL CLOSED: Cannot verify process state without PID
      this.coordinatorState = 'RECOVERY_REQUIRED';
      record.status = 'RECOVERY_REQUIRED';
      this.persistence?.updateStatus(targetId, 'RECOVERY_REQUIRED', 'Ambiguous unverified process state');
      return { recovered: false, reason: 'UNVERIFIED_PROCESS_STATE', targetId, lifecycleTrail };
    }

    // 2. Provider lifecycle status check (Workstream B / Phase 2.3.2.6)
    const provider = this.providers.get(record.resourceType);
    if (provider) {
      let status: ProviderStatus;
      try {
        status = await provider.getStatus();
      } catch (err: any) {
        this.coordinatorState = 'RECOVERY_REQUIRED';
        record.status = 'RECOVERY_REQUIRED';
        this.persistence?.updateStatus(targetId, 'RECOVERY_REQUIRED', `Provider status query failed: ${err?.message || err}`);
        return { recovered: false, reason: 'PROVIDER_QUERY_FAILED', targetId, lifecycleTrail };
      }

      // Workstream B: Strict runtime residency normalization
      const residency: ProviderResidencyState = normalizeResidency(status?.residency);

      if (residency !== 'RESIDENT' && residency !== 'NOT_RESIDENT') {
        this.coordinatorState = 'RECOVERY_REQUIRED';
        record.status = 'RECOVERY_REQUIRED';
        this.persistence?.updateStatus(targetId, 'RECOVERY_REQUIRED', 'Provider status is UNKNOWN');
        return { recovered: false, reason: 'PROVIDER_QUERY_FAILED', targetId, lifecycleTrail };
      }

      if (residency === 'RESIDENT') {
        lifecycleTrail.push('RECOVERY_UNLOADING');
        this.coordinatorState = 'RECOVERY_UNLOADING';
        record.status = 'UNLOADING';

        try {
          await provider.release(`${targetId}:recovery:unload`);
        } catch (err: any) {
          this.coordinatorState = 'RECOVERY_REQUIRED';
          record.status = 'RECOVERY_REQUIRED';
          this.persistence?.updateStatus(targetId, 'RECOVERY_REQUIRED', `Provider unload threw: ${err?.message || err}`);
          return { recovered: false, reason: 'PROVIDER_UNLOAD_FAILED', targetId, lifecycleTrail };
        }

        lifecycleTrail.push('RECOVERY_VERIFYING');
        this.coordinatorState = 'RECOVERY_VERIFYING';
        record.status = 'VERIFYING_RELEASE';

        const isVerified = await provider.verifyReleased(`${targetId}:recovery:unload`);
        if (!isVerified) {
          this.coordinatorState = 'RECOVERY_REQUIRED';
          record.status = 'RECOVERY_REQUIRED';
          this.persistence?.updateStatus(targetId, 'RECOVERY_REQUIRED', 'Provider reports resource still loaded after unload');
          return { recovered: false, reason: 'PROVIDER_STILL_LOADED', targetId, lifecycleTrail };
        }
      }
    }

    // Verified dead/terminated and provider confirms NOT_RESIDENT
    lifecycleTrail.push('RELEASED');
    record.status = 'RELEASED';
    record.releasedAt = this.now();
    this.persistence?.updateStatus(targetId, 'RELEASED', 'Recovered after verified process termination and provider unload', record.releasedAt);

    this.releasedReservations.set(targetId, record);
    if (this.activeReservation?.id === targetId) {
      this.activeReservation = null;
    }

    // Check if remaining unresolved reservations exist in persistence (Workstream E / AUDIT-2323-05)
    const remainingUnresolved = this.persistence?.getActiveOrUnresolved() ?? [];
    if (remainingUnresolved.length === 0) {
      lifecycleTrail.push('IDLE');
      this.coordinatorState = 'IDLE';
      this.metrics.totalRecoveries++;
      void this.processQueue();
    } else {
      this.activeReservation = remainingUnresolved[0];
      this.coordinatorState = 'RECOVERY_REQUIRED';
    }

    return { recovered: true, targetId, lifecycleTrail };
  }

  private async recoverAllUnresolved(
    callerId?: string,
    isSystem = false
  ): Promise<RecoveryResult> {
    if (callerId && !isSystem) {
      throw new ResourceCoordinatorError(
        'WRONG_OWNER',
        'Non-privileged caller cannot perform global multi-reservation recovery'
      );
    }

    const allUnresolved = this.persistence
      ? this.persistence.getActiveOrUnresolved()
      : (this.activeReservation ? [this.activeReservation] : []);

    if (allUnresolved.length === 0) {
      this.coordinatorState = 'IDLE';
      void this.processQueue();
      return { recovered: true, reason: 'NO_ACTIVE_RESERVATION', lifecycleTrail: ['NO_ACTIVE_RESERVATION', 'IDLE'] };
    }

    const lifecycleTrail: string[] = ['RECOVERY_INSPECTING'];
    this.coordinatorState = 'RECOVERY_INSPECTING';

    for (const rec of allUnresolved) {
      const singleResult = await this.recoverSingleReservation(rec.id, undefined, true);
      if (!singleResult.recovered) {
        this.coordinatorState = 'RECOVERY_REQUIRED';
        this.activeReservation = rec;
        return singleResult;
      }
    }

    this.activeReservation = null;
    this.coordinatorState = 'IDLE';
    void this.processQueue();
    return { recovered: true, lifecycleTrail: ['RECOVERY_INSPECTING', 'RELEASED', 'IDLE'] };
  }

  /**
   * Safe graceful shutdown.
   * Cancels all queued waiting requests. Active reservation is protected and left intact.
   */
  public async shutdown(): Promise<void> {
    this.coordinatorState = 'SHUTDOWN';

    // Clear and reject all queued requests
    while (this.waitingQueue.length > 0) {
      const item = this.waitingQueue.shift()!;
      if (item.timer) {
        clearTimeout(item.timer);
      }
      item.reject(
        new ResourceCoordinatorError('SHUTDOWN', 'ResourceCoordinator shutting down; request cancelled')
      );
    }
  }

  /**
   * Sanitized diagnostic snapshot for observability.
   */
  public getSnapshot(): CoordinatorSnapshot {
    return {
      coordinatorState: this.coordinatorState,
      activeReservation: this.activeReservation
        ? {
            id: this.activeReservation.id,
            resourceType: this.activeReservation.resourceType,
            ownerId: this.activeReservation.ownerId,
            status: this.activeReservation.status,
            acquiredAt: this.activeReservation.acquiredAt,
            pid: this.activeReservation.pid,
          }
        : null,
      queue: this.waitingQueue.map((q, idx) => ({
        id: q.id,
        resourceType: q.resourceType,
        ownerId: q.ownerId,
        requestedAt: q.requestedAt,
        queuePosition: idx,
      })),
      metrics: { ...this.metrics },
    };
  }

  /**
   * Constructs an ergonomic Reservation handle for an active lease.
   */
  private createReservationHandle(record: ReservationRecord): Reservation {
    return {
      id: record.id,
      resourceType: record.resourceType,
      ownerId: record.ownerId,
      pid: record.pid,
      acquiredAt: record.acquiredAt,
      getStatus: () => record.status,
      release: () => this.release(record.id, record.ownerId),
    };
  }
}
