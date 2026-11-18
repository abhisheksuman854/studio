/**
 * Phase 2.3.1: Resource Coordinator Core & Safe Admission Control
 * Type definitions, state models, contracts, and error hierarchy.
 */

export type ResourceType = 'LLM' | 'SDXL' | 'CPU_VIDEO_RENDER' | 'AUDIO_PROCESSING';

export const RESOURCE_TYPES: readonly ResourceType[] = [
  'LLM',
  'SDXL',
  'CPU_VIDEO_RENDER',
  'AUDIO_PROCESSING',
] as const;

export type CoordinatorState =
  | 'IDLE'
  | 'REQUESTED'
  | 'DRAINING'
  | 'UNLOADING'
  | 'VERIFYING_RELEASE'
  | 'PREPARING_ADMISSION'
  | 'LOADING'
  | 'ACTIVE'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'
  | 'RECOVERY_INSPECTING'
  | 'RECOVERY_UNLOADING'
  | 'RECOVERY_VERIFYING'
  | 'SHUTDOWN';

export type ReservationStatus =
  | 'REQUESTED'
  | 'PREPARING_ADMISSION'
  | 'LOADING'
  | 'ACTIVE'
  | 'DRAINING'
  | 'UNLOADING'
  | 'VERIFYING_RELEASE'
  | 'RELEASED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type WorkerLifecycleState =
  | 'SPAWN_PENDING'
  | 'SPAWNING'
  | 'RUNNING'
  | 'TERMINATING'
  | 'VERIFYING_TERMINATION'
  | 'TERMINATED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED';

export type IdentityVerificationState =
  | 'UNVERIFIED'
  | 'VERIFIED_MATCH'
  | 'RECYCLED_PID'
  | 'MISMATCH'
  | 'AMBIGUOUS'
  | 'DEAD';

export interface WorkerIdentityMetadata {
  readonly requestId: string;
  readonly processInstanceId: string;
  readonly workerType: string;
  readonly parentPid: number;
  readonly childPid: number | null;
  readonly childPgid: number | null;
  readonly processStartedAt: number | null;
  readonly lstart?: string;
  readonly reservationCreatedAt: number;
  readonly spawnRequestedAt: number | null;
  readonly spawnConfirmedAt: number | null;
  readonly identityPersistedAt: number | null;
  readonly recoveryAttemptedAt: number | null;
  readonly workerLifecycleState: WorkerLifecycleState;
  readonly identityVerificationState: IdentityVerificationState;
  readonly executable?: string;
  readonly command?: string;
}

export interface ReservationRequestOptions {
  readonly pid?: number;
  readonly timeoutMs?: number;
  readonly metadata?: Record<string, unknown>;
  readonly customReservationId?: string;
}

export interface ReservationRecord {
  readonly id: string;
  readonly resourceType: ResourceType;
  readonly ownerId: string;
  status: ReservationStatus;
  readonly pid?: number;
  readonly acquiredAt: number;
  lastHeartbeatAt: number;
  releasedAt?: number;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}

export interface Reservation {
  readonly id: string;
  readonly resourceType: ResourceType;
  readonly ownerId: string;
  readonly pid?: number;
  readonly acquiredAt: number;
  getStatus(): ReservationStatus;
  release(): Promise<ReleaseResult>;
}

export interface ReleaseResult {
  readonly success: boolean;
  readonly alreadyReleased: boolean;
  readonly reservationId: string;
  readonly error?: string;
}

export interface CoordinatorSnapshot {
  readonly coordinatorState: CoordinatorState;
  readonly activeReservation: {
    readonly id: string;
    readonly resourceType: ResourceType;
    readonly ownerId: string;
    readonly status: ReservationStatus;
    readonly acquiredAt: number;
    readonly pid?: number;
  } | null;
  readonly queue: ReadonlyArray<{
    readonly id: string;
    readonly resourceType: ResourceType;
    readonly ownerId: string;
    readonly requestedAt: number;
    readonly queuePosition: number;
  }>;
  readonly metrics: {
    readonly totalAcquired: number;
    readonly totalReleased: number;
    readonly totalCancelled: number;
    readonly totalTimedOut: number;
    readonly totalFailed: number;
    readonly totalRecoveries: number;
  };
}

export type ProviderResidencyState = 'RESIDENT' | 'NOT_RESIDENT' | 'UNKNOWN';

/**
 * Strict runtime normalization of model residency states (Workstream B / Phase 2.3.2.6).
 * Only explicit 'RESIDENT' or 'NOT_RESIDENT' strings are accepted.
 * All other values (numbers, booleans, objects, empty strings, invalid strings, null, undefined)
 * strictly evaluate to 'UNKNOWN'.
 */
export function normalizeResidency(value: unknown): ProviderResidencyState {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === 'RESIDENT') return 'RESIDENT';
    if (trimmed === 'NOT_RESIDENT') return 'NOT_RESIDENT';
  }
  return 'UNKNOWN';
}

export interface ProviderStatus {
  readonly availability?: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly residency?: ProviderResidencyState;
  readonly modelName?: string;
  readonly observedAt?: number;
  readonly source?: 'OLLAMA_API_PS' | string;
  readonly raw?: unknown;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly loaded: boolean;
  readonly providerState?: string;
}

export interface RecoveryResult {
  readonly recovered: boolean;
  readonly reason?: string;
  readonly targetId?: string;
  readonly lifecycleTrail?: readonly string[];
}

export interface RecoveryOptions {
  readonly callerId?: string;
  readonly isSystemPrivileged?: boolean;
}

export interface IResourceProviderLifecycle {
  readonly resourceType: ResourceType;
  isAvailable(): Promise<boolean>;
  getStatus(): Promise<ProviderStatus>;
  prepareForRelease(reservationId: string): Promise<void>;
  release(reservationId: string): Promise<void>;
  verifyReleased(reservationId: string): Promise<boolean>;
  recover?(reservationId: string): Promise<boolean>;
  prepareForAdmission?(targetResourceType: ResourceType): Promise<boolean>;
  unload?(options?: { maxDrainWaitMs?: number; pollRetries?: number; pollIntervalMs?: number }): Promise<any>;
}

export type ProcessLivenessStatus = boolean | 'UNKNOWN';

export interface ProcessLivenessChecker {
  isProcessAlive(pid: number): ProcessLivenessStatus;
}

export class DefaultProcessLivenessChecker implements ProcessLivenessChecker {
  isProcessAlive(pid: number): ProcessLivenessStatus {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      if (err.code === 'EPERM') return true;
      if (err.code === 'ESRCH') return false;
      return 'UNKNOWN';
    }
  }
}

export type ResourceCoordinatorErrorCode =
  | 'INVALID_RESOURCE'
  | 'INVALID_STATE_TRANSITION'
  | 'WRONG_OWNER'
  | 'RESERVATION_NOT_FOUND'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'ALREADY_ACTIVE'
  | 'ALREADY_REQUESTED'
  | 'RELEASE_FAILED'
  | 'RECOVERY_FAILED'
  | 'RECOVERY_REQUIRED'
  | 'PREPARATION_FAILED'
  | 'MODEL_NOT_INSTALLED'
  | 'DAEMON_UNAVAILABLE'
  | 'SHUTDOWN'
  | 'PERSISTENCE_ERROR'
  | 'ADMISSION_DENIED';

export class ResourceCoordinatorError extends Error {
  constructor(
    public readonly code: ResourceCoordinatorErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ResourceCoordinatorError';
  }
}
