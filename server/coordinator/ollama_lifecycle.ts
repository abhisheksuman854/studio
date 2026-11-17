/**
 * Phase 2.3.2: Ollama Runtime Lifecycle Adapter & Request Coordination
 * 
 * Provides an authoritative provider lifecycle adapter connecting the Resource Coordinator
 * with local Ollama inference, request serialization, model unload verification,
 * and fail-closed timeout/cancellation handling.
 */

import { validateOllamaEndpoint } from '../providers/llm.js';
import type { ResourceCoordinator } from './coordinator.js';
import {
  ResourceCoordinatorError,
  normalizeResidency,
  type CoordinatorState,
  type IResourceProviderLifecycle,
  type ProviderResidencyState,
  type ProviderStatus,
  type Reservation,
  type ResourceType,
} from './types.js';

export interface ModelAvailabilityStatus {
  readonly configuredModel: string;
  readonly installedModels: readonly string[];
  readonly isConfiguredModelInstalled: boolean;
  readonly daemonAvailable: boolean;
  readonly status: 'AVAILABLE' | 'MODEL_NOT_INSTALLED' | 'DAEMON_UNAVAILABLE';
}

export interface ModelUnloadObservation {
  readonly requestedAt: number;
  readonly completedAt?: number;
  readonly model: string;
  readonly psReportedNotResident: boolean;
  readonly inferenceRequestsDrained: boolean;
  /**
   * Section 7 / 18: /api/ps empty does NOT prove that all GPU Metal allocations
   * have been returned to macOS.
   */
  readonly metalMemoryDeallocationProven: false;
  /**
   * Section 7 / 18: /api/ps empty does NOT establish that system memory pressure
   * has fully recovered.
   */
  readonly systemMemoryPressureRecoveredProven: false;
  readonly status: 'VERIFIED_UNLOADED' | 'FAILED_STILL_RESIDENT' | 'UNLOAD_ERROR';
  readonly rawPs?: unknown;
  readonly error?: string;
}

export interface OllamaLifecycleDiagnostics {
  readonly coordinatorState: CoordinatorState | 'DISCONNECTED';
  readonly activeLLMRequestCount: number;
  readonly queuedLLMRequestCount: number;
  readonly currentReservationId: string | null;
  readonly reservationAgeMs: number | null;
  readonly modelResidencyObservation: {
    readonly resident: boolean;
    readonly model: string;
    readonly checkedAt: number;
  } | null;
  readonly providerHealthObservation: {
    readonly available: boolean;
    readonly checkedAt: number;
  } | null;
  readonly lastLifecycleOutcome: string;
  readonly recoveryRequired: boolean;
  readonly lastUnloadObservation?: ModelUnloadObservation;
}

export interface InFlightRequest {
  readonly reservationId: string;
  readonly ownerId: string;
  readonly startedAt: number;
  status: 'ACTIVE' | 'DRAINING' | 'COMPLETED' | 'FAILED';
  uncertain?: boolean;
  error?: string;
  completedAt?: number;
}

export interface OllamaLifecycleAdapterOptions {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
  readonly unloadOnRelease?: boolean;
}

export class OllamaLifecycleAdapter implements IResourceProviderLifecycle {
  public readonly resourceType: ResourceType = 'LLM';
  public readonly baseUrl: string;
  public readonly model: string;
  public readonly timeoutMs: number;
  public readonly fetchFn: typeof fetch;
  public unloadOnRelease: boolean;

  private readonly activeRequests = new Map<string, InFlightRequest>();
  private lastResidencyObservation: { resident: boolean; model: string; checkedAt: number } | null = null;
  private lastHealthObservation: { available: boolean; checkedAt: number } | null = null;
  private lastUnloadObservation?: ModelUnloadObservation;
  private lastLifecycleOutcome: string = 'IDLE';

  constructor(options: OllamaLifecycleAdapterOptions = {}) {
    const rawEndpoint = options.baseUrl || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    this.baseUrl = validateOllamaEndpoint(rawEndpoint);
    this.model = options.model || 'qwen2.5:1.5b';
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.unloadOnRelease = options.unloadOnRelease ?? false;
  }

  /**
   * Checks if local Ollama daemon is reachable on http://127.0.0.1:11434.
   */
  public async isAvailable(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      const ok = res.ok;
      this.lastHealthObservation = { available: ok, checkedAt: Date.now() };
      return ok;
    } catch {
      this.lastHealthObservation = { available: false, checkedAt: Date.now() };
      return false;
    }
  }

  /**
   * Queries Ollama /api/ps to verify if model is currently loaded in memory.
   * Returns explicit ProviderStatus model where query failures report residency='UNKNOWN' (fail-closed).
   */
  public async getStatus(): Promise<ProviderStatus> {
    const observedAt = Date.now();
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/ps`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return {
          availability: 'UNAVAILABLE',
          residency: 'UNKNOWN',
          modelName: this.model,
          observedAt,
          source: 'OLLAMA_API_PS',
          errorCode: `HTTP_${res.status}`,
          errorMessage: `Ollama returned HTTP ${res.status}`,
          loaded: false,
          providerState: 'QUERY_FAILED',
        };
      }
      const data = (await res.json()) as any;
      const models = Array.isArray(data?.models) ? data.models : [];
      const isResident = models.some(
        (m: any) =>
          m.name === this.model ||
          m.model === this.model ||
          (typeof m.name === 'string' && m.name.startsWith(this.model)) ||
          (typeof m.model === 'string' && m.model.startsWith(this.model))
      );

      this.lastResidencyObservation = {
        resident: isResident,
        model: this.model,
        checkedAt: observedAt,
      };

      return {
        availability: 'AVAILABLE',
        residency: isResident ? 'RESIDENT' : 'NOT_RESIDENT',
        modelName: this.model,
        observedAt,
        source: 'OLLAMA_API_PS',
        raw: data,
        loaded: isResident,
        providerState: isResident ? 'RESIDENT' : 'NOT_RESIDENT',
      };
    } catch (err: any) {
      return {
        availability: 'UNKNOWN',
        residency: 'UNKNOWN',
        modelName: this.model,
        observedAt,
        source: 'OLLAMA_API_PS',
        errorCode: err?.name || 'FETCH_ERROR',
        errorMessage: err?.message || String(err),
        loaded: false,
        providerState: `ERROR: ${err?.message || err}`,
      };
    }
  }

  /**
   * Prepares the provider before coordinator releases reservation.
   * If an in-flight request is active, transitions it to DRAINING.
   */
  public async prepareForRelease(reservationId: string): Promise<void> {
    const req = this.activeRequests.get(reservationId);
    if (req && req.status === 'ACTIVE') {
      req.status = 'DRAINING';
      this.lastLifecycleOutcome = 'DRAINING';
    }
  }

  /**
   * Prepares provider for admission of memory-intensive workloads (Workstream G).
   * Checks residency and performs drain + keep_alive: 0 + bounded verification.
   */
  public async prepareForAdmission(targetResourceType: ResourceType): Promise<boolean> {
    const status = await this.getStatus();
    const residency = normalizeResidency(status?.residency);
    if (residency === 'NOT_RESIDENT') {
      return true;
    }
    if (residency === 'RESIDENT') {
      try {
        const observation = await this.performUnload();
        return observation.status === 'VERIFIED_UNLOADED' && observation.psReportedNotResident;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Core shared unload implementation (Workstream G / AUDIT-2323-07).
   * All unload operations share this method:
   * 1. Waits for active inference requests to drain (up to maxDrainWaitMs).
   * 2. Issues keep_alive: 0.
   * 3. Polls /api/ps with bounded retries (pollRetries x pollIntervalMs).
   * 4. Enforces residency === 'NOT_RESIDENT'.
   */
  public async performUnload(options: {
    maxDrainWaitMs?: number;
    pollRetries?: number;
    pollIntervalMs?: number;
    excludeReservationId?: string;
  } = {}): Promise<ModelUnloadObservation> {
    const requestedAt = Date.now();
    const maxDrainWaitMs = options.maxDrainWaitMs ?? 15000;
    const pollRetries = options.pollRetries ?? 10;
    const pollIntervalMs = options.pollIntervalMs ?? 200;

    // Step 1: Wait for in-flight inference requests to drain
    const drainStart = Date.now();
    while (this.getActiveInferenceCount(options.excludeReservationId) > 0) {
      if (Date.now() - drainStart > maxDrainWaitMs) {
        throw new ResourceCoordinatorError(
          'TIMEOUT',
          `Active inference requests failed to drain within ${maxDrainWaitMs}ms`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Step 2: Send keep_alive: 0
    let unloadErr: string | undefined;
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, keep_alive: 0 }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        unloadErr = `Ollama HTTP ${res.status} during keep_alive: 0`;
      }
    } catch (err: any) {
      unloadErr = err?.message || 'Network error during keep_alive: 0';
    }

    // Step 3: Poll /api/ps with bounded retry loop and verify model is no longer resident
    let psReportedNotResident = false;
    let lastStatus: ProviderStatus | undefined;

    for (let attempt = 0; attempt < pollRetries; attempt++) {
      lastStatus = await this.getStatus();
      if (normalizeResidency(lastStatus?.residency) === 'NOT_RESIDENT') {
        psReportedNotResident = true;
        break;
      }
      if (attempt < pollRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    const observation: ModelUnloadObservation = {
      requestedAt,
      completedAt: Date.now(),
      model: this.model,
      psReportedNotResident,
      inferenceRequestsDrained: true,
      metalMemoryDeallocationProven: false,
      systemMemoryPressureRecoveredProven: false,
      status: psReportedNotResident && !unloadErr ? 'VERIFIED_UNLOADED' : 'FAILED_STILL_RESIDENT',
      rawPs: lastStatus?.raw,
      error: unloadErr,
    };

    this.lastUnloadObservation = observation;
    return observation;
  }

  public async unload(options?: {
    maxDrainWaitMs?: number;
    pollRetries?: number;
    pollIntervalMs?: number;
  }): Promise<ModelUnloadObservation> {
    return this.performUnload(options);
  }

  /**
   * Release hook called by the coordinator.
   * If unload is required, routes through shared performUnload.
   */
  public async release(reservationId: string): Promise<void> {
    const req = this.activeRequests.get(reservationId);
    const requiresUnload =
      this.unloadOnRelease ||
      !reservationId ||
      reservationId.includes('unload') ||
      reservationId.includes('recovery');

    if (requiresUnload) {
      this.lastLifecycleOutcome = 'UNLOAD_REQUESTED';
      try {
        await this.performUnload({ excludeReservationId: reservationId });
      } catch (err: any) {
        // Do not throw here; verifyReleased will formally check whether unload succeeded.
      }
    } else {
      if (req) {
        req.status = 'COMPLETED';
        req.completedAt = Date.now();
      }
      this.lastLifecycleOutcome = 'COMPLETED';
    }
  }

  /**
   * Release verification called by the coordinator.
   * Only residency === 'NOT_RESIDENT' satisfies unload verification.
   * If status is 'UNKNOWN' or 'RESIDENT', verification fails closed.
   */
  public async verifyReleased(reservationId?: string): Promise<boolean> {
    const req = reservationId ? this.activeRequests.get(reservationId) : undefined;

    // If request failed with uncertain state, release verification MUST fail closed
    if (req?.uncertain) {
      this.lastLifecycleOutcome = 'UNCERTAIN_TERMINATION';
      return false;
    }

    const requiresUnload =
      this.unloadOnRelease ||
      !reservationId ||
      reservationId.includes('unload') ||
      reservationId.includes('recovery');

    if (requiresUnload) {
      const observation = this.lastUnloadObservation;
      let verifiedNotResident = false;
      if (observation && observation.requestedAt >= (req?.startedAt ?? 0)) {
        verifiedNotResident = observation.psReportedNotResident && observation.status === 'VERIFIED_UNLOADED';
      } else {
        const status = await this.getStatus();
        verifiedNotResident = normalizeResidency(status?.residency) === 'NOT_RESIDENT';
        this.lastUnloadObservation = {
          requestedAt: req?.startedAt ?? Date.now(),
          completedAt: Date.now(),
          model: this.model,
          psReportedNotResident: verifiedNotResident,
          inferenceRequestsDrained: this.activeRequests.size <= 1,
          metalMemoryDeallocationProven: false,
          systemMemoryPressureRecoveredProven: false,
          status: verifiedNotResident ? 'VERIFIED_UNLOADED' : 'FAILED_STILL_RESIDENT',
          rawPs: status.raw,
        };
      }

      if (!verifiedNotResident) {
        this.lastLifecycleOutcome = 'UNLOAD_VERIFICATION_FAILED';
        return false;
      }

      this.lastLifecycleOutcome = 'UNLOADED';
      if (reservationId) {
        this.activeRequests.delete(reservationId);
      }
      return true;
    }

    // Normal inference completion verification
    this.activeRequests.delete(reservationId);
    this.lastLifecycleOutcome = 'RELEASED';
    return true;
  }

  /**
   * Recovers an unresolved reservation:
   * Checks /api/ps; if loaded, attempts keep_alive: 0 and verifies unload.
   * If status is UNKNOWN, fails closed without guessing.
   */
  public async recover(reservationId: string): Promise<boolean> {
    const status = await this.getStatus();
    const residency = normalizeResidency(status?.residency);
    if (residency === 'NOT_RESIDENT') {
      this.activeRequests.delete(reservationId);
      this.lastLifecycleOutcome = 'RECOVERED_NOT_RESIDENT';
      return true;
    }

    if (residency === 'UNKNOWN') {
      this.lastLifecycleOutcome = 'RECOVERY_FAILED_STATUS_UNKNOWN';
      return false;
    }

    // Attempt to force unload via keep_alive: 0
    try {
      await this.fetchFn(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, keep_alive: 0 }),
        signal: AbortSignal.timeout(10000),
      });

      // Re-verify residency via /api/ps
      const recheck = await this.getStatus();
      if (recheck.residency === 'NOT_RESIDENT') {
        this.activeRequests.delete(reservationId);
        this.lastLifecycleOutcome = 'RECOVERED_AFTER_UNLOAD';
        return true;
      }
    } catch {
      // Recovery failed
    }

    this.lastLifecycleOutcome = 'RECOVERY_FAILED_STILL_RESIDENT';
    return false;
  }

  /**
   * Diagnostic model availability checker (Workstream F).
   * Queries /api/tags to verify whether configured model is genuinely present.
   */
  public async checkModelAvailability(): Promise<ModelAvailabilityStatus> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return {
          configuredModel: this.model,
          installedModels: [],
          isConfiguredModelInstalled: false,
          daemonAvailable: false,
          status: 'DAEMON_UNAVAILABLE',
        };
      }
      const data = (await res.json()) as any;
      const rawModels = Array.isArray(data?.models) ? data.models : [];
      const installedModels: string[] = rawModels
        .map((m: any) => m.name || m.model || String(m))
        .filter(Boolean);
      const isConfiguredModelInstalled = installedModels.some(
        (m: string) =>
          m === this.model ||
          m.startsWith(this.model) ||
          (this.model.includes(':') ? m === this.model : m.startsWith(`${this.model}:`))
      );
      return {
        configuredModel: this.model,
        installedModels,
        isConfiguredModelInstalled,
        daemonAvailable: true,
        status: isConfiguredModelInstalled ? 'AVAILABLE' : 'MODEL_NOT_INSTALLED',
      };
    } catch {
      return {
        configuredModel: this.model,
        installedModels: [],
        isConfiguredModelInstalled: false,
        daemonAvailable: false,
        status: 'DAEMON_UNAVAILABLE',
      };
    }
  }

  /**
   * Executes the coordinated model unload lifecycle sequence (Workstream D & E).
   * 1. Acquires LLM reservation (or verifies recovery mode) to stop new admissions.
   * 2. Waits for active inference requests to drain.
   * 3. Sends keep_alive: 0 to Ollama.
   * 4. Polls /api/ps with bounded retry loop (10 retries x 200ms default).
   * 5. Verifies model is not resident.
   * 6. Releases reservation or marks RECOVERY_REQUIRED.
   */
  public async coordinatedUnload(
    coordinator: ResourceCoordinator,
    ownerIdOrOptions:
      | string
      | {
          timeoutMs?: number;
          maxDrainWaitMs?: number;
          pollRetries?: number;
          pollIntervalMs?: number;
        } = 'system:unload',
    optionsArg?: {
      timeoutMs?: number;
      maxDrainWaitMs?: number;
      pollRetries?: number;
      pollIntervalMs?: number;
    }
  ): Promise<ModelUnloadObservation> {
    const ownerId = typeof ownerIdOrOptions === 'string' ? ownerIdOrOptions : 'system:unload';
    const options = typeof ownerIdOrOptions === 'object' ? ownerIdOrOptions : optionsArg ?? {};
    const requestedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 30000;
    const maxDrainWaitMs = options.maxDrainWaitMs ?? 15000;
    const pollRetries = options.pollRetries ?? 10;
    const pollIntervalMs = options.pollIntervalMs ?? 200;

    const currentState = coordinator.getState();
    const isRecoveryMode =
      currentState === 'RECOVERY_REQUIRED' ||
      currentState === 'RECOVERY_INSPECTING' ||
      currentState === 'RECOVERY_UNLOADING' ||
      currentState === 'RECOVERY_VERIFYING';

    let reservation: Reservation | null = null;
    if (!isRecoveryMode) {
      // Step 1: Acquire exclusive reservation to block any new admissions
      reservation = await coordinator.acquire('LLM', ownerId, {
        timeoutMs,
        metadata: { operation: 'MODEL_UNLOAD', model: this.model, unload: true },
      });
    }

    try {
      // Step 2 to 5: Delegate to canonical performUnload (drain -> keep_alive: 0 -> bounded retry polling)
      const observation = await this.performUnload({
        maxDrainWaitMs,
        pollRetries,
        pollIntervalMs,
        excludeReservationId: reservation?.id,
      });

      // Step 6: If unload verification failed, lock coordinator fail-closed
      if (!observation.psReportedNotResident || observation.error || observation.status !== 'VERIFIED_UNLOADED') {
        if (reservation) {
          coordinator.markRecoveryRequired(
            reservation.id,
            observation.error || 'Ollama /api/ps confirms model remains resident after unload request'
          );
        }
        this.lastLifecycleOutcome = 'UNLOAD_VERIFICATION_FAILED';
        return observation;
      }

      // Step 7: Release reservation cleanly or clear recovery lock
      if (reservation) {
        this.activeRequests.delete(reservation.id);
        await coordinator.release(reservation.id, ownerId);
      } else if (isRecoveryMode) {
        await coordinator.recover(undefined, { isSystemPrivileged: true });
      }

      this.lastLifecycleOutcome = 'UNLOADED';
      return observation;
    } catch (err: any) {
      if (reservation) {
        coordinator.markRecoveryRequired(
          reservation.id,
          `Coordinated unload aborted: ${err?.message || err}`
        );
      }
      this.lastLifecycleOutcome = 'UNLOAD_ERROR';
      return {
        requestedAt,
        completedAt: Date.now(),
        model: this.model,
        psReportedNotResident: false,
        inferenceRequestsDrained: false,
        metalMemoryDeallocationProven: false,
        systemMemoryPressureRecoveredProven: false,
        status: 'UNLOAD_ERROR',
        error: err?.message || String(err),
      };
    }
  }

  // --- Request Tracking Helpers ---

  public startRequest(reservationId: string, ownerId: string): void {
    this.activeRequests.set(reservationId, {
      reservationId,
      ownerId,
      startedAt: Date.now(),
      status: 'ACTIVE',
    });
    this.lastLifecycleOutcome = 'ACTIVE';
  }

  public completeRequest(reservationId: string): void {
    const req = this.activeRequests.get(reservationId);
    if (req) {
      req.status = 'COMPLETED';
      req.completedAt = Date.now();
    }
    this.lastLifecycleOutcome = 'COMPLETED';
  }

  public failRequest(reservationId: string, error: Error, uncertain = false): void {
    const req = this.activeRequests.get(reservationId);
    if (req) {
      req.status = 'FAILED';
      req.uncertain = uncertain;
      req.error = error.message;
      req.completedAt = Date.now();
    }
    this.lastLifecycleOutcome = uncertain ? 'UNCERTAIN_TERMINATION' : 'FAILED';
  }

  public isRequestActive(reservationId: string): boolean {
    const req = this.activeRequests.get(reservationId);
    return req !== undefined && (req.status === 'ACTIVE' || req.status === 'DRAINING');
  }

  public getActiveRequestCount(): number {
    let count = 0;
    for (const r of this.activeRequests.values()) {
      if (r.status === 'ACTIVE' || r.status === 'DRAINING') count++;
    }
    return count;
  }

  private getActiveInferenceCount(excludeReservationId?: string): number {
    let count = 0;
    for (const [id, r] of this.activeRequests.entries()) {
      if (id === excludeReservationId) continue;
      if (r.status === 'ACTIVE' || r.status === 'DRAINING') count++;
    }
    return count;
  }

  /**
   * Sanitized operational diagnostic snapshot (Section 13).
   * Does NOT expose prompts, private RAG context, or raw errors.
   */
  public async getDiagnostics(coordinator?: ResourceCoordinator): Promise<OllamaLifecycleDiagnostics> {
    const activeRes = coordinator?.getActiveReservation();
    const age = activeRes ? Date.now() - activeRes.acquiredAt : null;

    return {
      coordinatorState: coordinator ? coordinator.getState() : 'DISCONNECTED',
      activeLLMRequestCount: this.getActiveRequestCount(),
      queuedLLMRequestCount: coordinator ? coordinator.getQueueLength() : 0,
      currentReservationId: activeRes?.id ?? null,
      reservationAgeMs: age,
      modelResidencyObservation: this.lastResidencyObservation,
      providerHealthObservation: this.lastHealthObservation,
      lastLifecycleOutcome: this.lastLifecycleOutcome,
      recoveryRequired: coordinator ? coordinator.getState() === 'RECOVERY_REQUIRED' : false,
      lastUnloadObservation: this.lastUnloadObservation,
    };
  }
}

