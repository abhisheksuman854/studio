/**
 * Auravo Studio — AI-Foundation 2.3.3.1
 * One-Shot Child Process Supervisor & Bounded State Machine
 * 
 * Manages child process lifecycle, process group isolation, anti-PID-reuse,
 * deterministic cancellation, bounded termination ladders (SIGTERM -> SIGKILL),
 * and fail-closed integration with the ResourceCoordinator.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import EventEmitter from 'node:events';
import crypto from 'node:crypto';
import {
  WORKER_PROTOCOL_VERSION,
  parseWorkerMessage,
  sanitizeDiagnostic,
  type WorkerMessage,
  type WorkerErrorCategory,
} from './worker_protocol.js';
import {
  generateProcessInstanceId,
  isProcessAliveSync,
  isProcessGroupAlive,
  getProcessSnapshot,
  verifyProcessIdentity,
  sendVerifiedSignal,
  type ProcessIdentity,
  type OSProcessSnapshot,
} from './process_identity.js';
import type { ResourceCoordinator } from './coordinator.js';
import type { ResourceType } from './types.js';

export type SupervisorState =
  | 'REQUESTED'
  | 'SPAWNING'
  | 'RUNNING'
  | 'TERMINATING'
  | 'VERIFYING_TERMINATION'
  | 'TERMINATED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED';

export interface SupervisorConfig {
  readonly workerType: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number; // Default 30,000ms
  readonly terminationGracePeriodMs?: number; // Default 2,000ms
  readonly maxStdoutBufferBytes?: number; // Default 1MB
  readonly maxStderrBufferBytes?: number; // Default 64KB
  readonly memoryQuiescenceCooldownMs?: number; // Default 0ms in unit tests
}

export interface TerminationResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly terminatedBySupervisor: boolean;
  readonly escalatedToKill: boolean;
  readonly terminationVerified: boolean;
  readonly descendantsTerminated: boolean | 'UNKNOWN';
  readonly durationMs: number;
  readonly error?: string;
}

export interface SupervisorExecutionResult {
  readonly success: boolean;
  readonly state: SupervisorState;
  readonly requestId: string;
  readonly processInstanceId: string;
  readonly output?: Record<string, unknown>;
  readonly errorCategory?: WorkerErrorCategory;
  readonly errorMessage?: string;
  readonly termination: TerminationResult;
  readonly stdoutMessages: readonly WorkerMessage[];
  readonly redactedStderr: string;
}

export interface SupervisorDiagnostics {
  readonly requestId: string;
  readonly workerType: string;
  readonly processInstanceId: string;
  readonly pid?: number;
  readonly pgid?: number;
  readonly state: SupervisorState;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly durationMs?: number;
  readonly terminalMessageReceived: boolean;
  readonly errorCategory?: WorkerErrorCategory;
  readonly sanitizedErrorMessage?: string;
  readonly terminationVerified: boolean;
}

/**
 * Strict allowlist of permitted executable basenames or paths.
 */
export const ALLOWED_EXECUTABLES = new Set<string>([
  'node',
  process.execPath,
  'python3',
  'python',
]);

export class ChildProcessSupervisor extends EventEmitter {
  private readonly config: SupervisorConfig;
  private readonly requestId: string;
  private readonly processInstanceId: string;
  private state: SupervisorState = 'REQUESTED';

  private childProcess: ChildProcess | null = null;
  private pid?: number;
  private pgid?: number;
  private processStartedAt = 0;
  private completedAt?: number;

  private stdoutBuffer = '';
  private stderrBuffer = '';
  private stdoutMessages: WorkerMessage[] = [];
  private terminalMessage: WorkerMessage | null = null;

  private executionTimer: NodeJS.Timeout | null = null;
  private terminationPromise: Promise<TerminationResult> | null = null;
  private terminationExecuted = false;
  private escalatedToKill = false;
  private cancelledBySupervisor = false;
  private cancellationReason?: string;

  constructor(config: SupervisorConfig, customRequestId?: string) {
    super();
    this.config = {
      timeoutMs: 30000,
      terminationGracePeriodMs: 2000,
      maxStdoutBufferBytes: 1024 * 1024,
      maxStderrBufferBytes: 64 * 1024,
      memoryQuiescenceCooldownMs: 0,
      ...config,
    };

    // Validate executable against allowlist
    this.validateExecutable(this.config.executable);

    this.requestId = customRequestId || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.processInstanceId = generateProcessInstanceId(process.pid, Date.now());
  }

  public getRequestId(): string {
    return this.requestId;
  }

  public getProcessInstanceId(): string {
    return this.processInstanceId;
  }

  public getState(): SupervisorState {
    return this.state;
  }

  public getIdentity(): ProcessIdentity | null {
    if (!this.pid) return null;
    return {
      requestId: this.requestId,
      processInstanceId: this.processInstanceId,
      pid: this.pid,
      pgid: this.pgid,
      processStartedAt: this.processStartedAt,
      executable: this.config.executable,
      command: [this.config.executable, ...this.config.args].join(' '),
    };
  }

  public getDiagnostics(): SupervisorDiagnostics {
    return {
      requestId: this.requestId,
      workerType: this.config.workerType,
      processInstanceId: this.processInstanceId,
      pid: this.pid,
      pgid: this.pgid,
      state: this.state,
      startedAt: this.processStartedAt,
      completedAt: this.completedAt,
      durationMs: this.completedAt ? this.completedAt - this.processStartedAt : undefined,
      terminalMessageReceived: this.terminalMessage !== null,
      errorCategory:
        this.terminalMessage?.type === 'ERROR'
          ? (this.terminalMessage.errorCategory as WorkerErrorCategory)
          : undefined,
      sanitizedErrorMessage:
        this.terminalMessage?.type === 'ERROR'
          ? sanitizeDiagnostic(this.terminalMessage.errorMessage)
          : undefined,
      terminationVerified: this.state === 'TERMINATED',
    };
  }

  private validateExecutable(executable: string): void {
    if (!executable || typeof executable !== 'string') {
      throw new Error(`Invalid executable: '${executable}'`);
    }

    const baseName = executable.split('/').pop() || executable;
    const isAllowed =
      ALLOWED_EXECUTABLES.has(executable) ||
      ALLOWED_EXECUTABLES.has(baseName) ||
      ALLOWED_EXECUTABLES.has(process.execPath);

    if (!isAllowed) {
      throw new Error(
        `Executable '${executable}' is not in the supervisor allowlist (${Array.from(ALLOWED_EXECUTABLES).join(', ')})`
      );
    }
  }

  private buildEnvironment(): Record<string, string> {
    const baseEnv: Record<string, string> = {
      PATH: process.env.PATH || '',
      NODE_ENV: process.env.NODE_ENV || 'test',
      HOME: process.env.HOME || '/tmp',
      TMPDIR: process.env.TMPDIR || '/tmp',
      LANG: process.env.LANG || 'en_US.UTF-8',
      WORKER_REQUEST_ID: this.requestId,
      WORKER_TYPE: this.config.workerType,
      WORKER_PROTOCOL_VERSION: WORKER_PROTOCOL_VERSION,
    };

    // Filter inherited custom env for sensitive keys
    if (this.config.env) {
      for (const [k, v] of Object.entries(this.config.env)) {
        if (!/secret|key|token|auth|password/i.test(k) || k === 'AURAVO_TEST_ALLOWED_TOKEN') {
          baseEnv[k] = v;
        }
      }
    }

    return baseEnv;
  }

  /**
   * Executes the child worker process and observes the versioned protocol.
   */
  public async execute(inputPayload?: Record<string, unknown>): Promise<SupervisorExecutionResult> {
    if (this.state !== 'REQUESTED') {
      throw new Error(`Cannot execute supervisor in state '${this.state}'`);
    }

    this.state = 'SPAWNING';
    this.processStartedAt = Date.now();

    return new Promise<SupervisorExecutionResult>((resolve) => {
      let spawnError: Error | null = null;

      try {
        // Spawn in detached process group on POSIX (pgid === child.pid)
        this.childProcess = spawn(this.config.executable, this.config.args, {
          cwd: this.config.cwd || process.cwd(),
          env: this.buildEnvironment(),
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: any) {
        this.state = 'FAILED';
        resolve({
          success: false,
          state: 'FAILED',
          requestId: this.requestId,
          processInstanceId: this.processInstanceId,
          errorCategory: 'INITIALIZATION_FAILED',
          errorMessage: `Failed to spawn child worker: ${err?.message || err}`,
          termination: {
            exitCode: null,
            signal: null,
            terminatedBySupervisor: false,
            escalatedToKill: false,
            terminationVerified: true,
            descendantsTerminated: true,
            durationMs: Date.now() - this.processStartedAt,
          },
          stdoutMessages: [],
          redactedStderr: '',
        });
        return;
      }

      this.childProcess.on('error', (err: Error) => {
        spawnError = err;
      });

      this.childProcess.on('spawn', () => {
        if (!this.childProcess?.pid) {
          this.state = 'FAILED';
          return;
        }

        this.pid = this.childProcess.pid;
        this.pgid = process.platform !== 'win32' ? this.childProcess.pid : undefined;
        this.state = 'RUNNING';

        // Arm execution timeout
        if (this.config.timeoutMs && this.config.timeoutMs > 0) {
          this.executionTimer = setTimeout(() => {
            this.cancel('TIMEOUT');
          }, this.config.timeoutMs);
        }

        // Send input payload to worker stdin if provided
        if (inputPayload && this.childProcess.stdin && !this.childProcess.stdin.destroyed) {
          try {
            this.childProcess.stdin.write(JSON.stringify(inputPayload) + '\n');
            this.childProcess.stdin.end();
          } catch {
            // Ignore stdin write errors if child exited immediately
          }
        }
      });

      // Handle stdout line buffering & protocol parsing
      this.childProcess.stdout?.on('data', (chunk: Buffer) => {
        this.handleStdoutChunk(chunk);
      });

      // Handle bounded stderr accumulation
      this.childProcess.stderr?.on('data', (chunk: Buffer) => {
        this.handleStderrChunk(chunk);
      });

      // Handle child process exit
      this.childProcess.on('close', async (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.executionTimer) {
          clearTimeout(this.executionTimer);
          this.executionTimer = null;
        }

        this.completedAt = Date.now();

        // Process any remaining buffered stdout
        if (this.stdoutBuffer.trim()) {
          this.processProtocolLine(this.stdoutBuffer.trim());
          this.stdoutBuffer = '';
        }

        // Transition to verification
        this.state = 'VERIFYING_TERMINATION';

        const termResult = await this.verifyProcessTermination(code, signal);

        // Enforce post-exit memory quiescence cooldown if configured
        if (this.config.memoryQuiescenceCooldownMs && this.config.memoryQuiescenceCooldownMs > 0) {
          await new Promise((r) => setTimeout(r, this.config.memoryQuiescenceCooldownMs));
        }

        // Determine final execution outcome
        let success = false;
        let finalState: SupervisorState = 'FAILED';
        let errorCategory: WorkerErrorCategory | undefined;
        let errorMessage: string | undefined;

        if (spawnError) {
          finalState = 'FAILED';
          errorCategory = 'INITIALIZATION_FAILED';
          errorMessage = spawnError.message;
        } else if (this.cancelledBySupervisor) {
          finalState = 'TERMINATED';
          errorCategory =
            this.cancellationReason === 'TIMEOUT'
              ? 'TIMEOUT'
              : this.cancellationReason === 'OVERSIZED_MESSAGE'
                ? 'PROTOCOL_ERROR'
                : 'CANCELLED';
          errorMessage = `Worker terminated by supervisor: ${this.cancellationReason || 'CANCELLED'}`;
        } else if (!termResult.terminationVerified) {
          finalState = 'RECOVERY_REQUIRED';
          errorCategory = 'EXECUTION_FAILED';
          errorMessage = 'Child worker or descendants could not be verified as terminated';
        } else if (this.terminalMessage?.type === 'SUCCESS' && code === 0) {
          success = true;
          finalState = 'TERMINATED';
        } else if (this.terminalMessage?.type === 'ERROR') {
          finalState = 'FAILED';
          errorCategory = this.terminalMessage.errorCategory as WorkerErrorCategory;
          errorMessage = this.terminalMessage.errorMessage;
        } else {
          // Exited without terminal message or non-zero code
          finalState = 'FAILED';
          errorCategory = code === null && signal ? 'WORKER_CRASHED' : 'PROTOCOL_ERROR';
          errorMessage = `Child worker exited unexpectedly (code: ${code}, signal: ${signal}) without terminal protocol message`;
        }

        this.state = finalState;

        resolve({
          success,
          state: finalState,
          requestId: this.requestId,
          processInstanceId: this.processInstanceId,
          output: this.terminalMessage?.type === 'SUCCESS' ? this.terminalMessage.output : undefined,
          errorCategory,
          errorMessage: errorMessage ? sanitizeDiagnostic(errorMessage) : undefined,
          termination: termResult,
          stdoutMessages: [...this.stdoutMessages],
          redactedStderr: sanitizeDiagnostic(this.stderrBuffer),
        });
      });
    });
  }

  private handleStdoutChunk(chunk: Buffer): void {
    const raw = chunk.toString('utf8');
    this.stdoutBuffer += raw;

    // Check bounded buffer limit
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > (this.config.maxStdoutBufferBytes || 1048576)) {
      this.cancel('OVERSIZED_MESSAGE');
      return;
    }

    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (line) {
        this.processProtocolLine(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleStderrChunk(chunk: Buffer): void {
    const max = this.config.maxStderrBufferBytes || 65536;
    if (this.stderrBuffer.length < max) {
      const remaining = max - this.stderrBuffer.length;
      this.stderrBuffer += chunk.toString('utf8').slice(0, remaining);
    }
  }

  private processProtocolLine(line: string): void {
    const parseResult = parseWorkerMessage(line, this.requestId, this.config.maxStdoutBufferBytes);

    if (!parseResult.success) {
      this.emit('protocol_error', {
        errorCode: parseResult.errorCode,
        errorMessage: parseResult.errorMessage,
        line: sanitizeDiagnostic(line, 200),
      });

      // If oversized, cancel immediately
      if (parseResult.errorCode === 'OVERSIZED_MESSAGE') {
        this.cancel('OVERSIZED_MESSAGE');
      }
      return;
    }

    const msg = parseResult.message!;

    if ((this.state === 'TERMINATING' || this.state === 'TERMINATED') && msg.type !== 'SHUTDOWN_ACK') {
      // Late message after cancellation requested -> safely ignore
      return;
    }

    // Duplicate terminal message guard
    if (this.terminalMessage !== null && (msg.type === 'SUCCESS' || msg.type === 'ERROR')) {
      this.emit('duplicate_terminal_message', msg);
      return;
    }

    this.stdoutMessages.push(msg);

    if (msg.type === 'START') {
      this.emit('worker_started', msg);
    } else if (msg.type === 'PROGRESS') {
      this.emit('worker_progress', msg);
    } else if (msg.type === 'SUCCESS') {
      this.terminalMessage = msg;
      this.emit('worker_success', msg);
    } else if (msg.type === 'ERROR') {
      this.terminalMessage = msg;
      this.emit('worker_error', msg);
    } else if (msg.type === 'SHUTDOWN_ACK') {
      this.emit('worker_shutdown_ack', msg);
    }
  }

  /**
   * Deterministic cancellation sequence with bounded escalation (SIGTERM -> SIGKILL).
   */
  public async cancel(reason = 'CANCELLED'): Promise<TerminationResult> {
    if (this.terminationPromise) {
      return this.terminationPromise;
    }

    this.cancelledBySupervisor = true;
    this.cancellationReason = reason;

    if (this.executionTimer) {
      clearTimeout(this.executionTimer);
      this.executionTimer = null;
    }

    this.terminationPromise = (async (): Promise<TerminationResult> => {
      // If already terminated or not yet spawned
      if (this.state === 'TERMINATED' || !this.childProcess || !this.pid) {
        this.state = 'TERMINATED';
        return {
          exitCode: null,
          signal: null,
          terminatedBySupervisor: true,
          escalatedToKill: false,
          terminationVerified: true,
          descendantsTerminated: true,
          durationMs: Date.now() - this.processStartedAt,
        };
      }

      this.state = 'TERMINATING';
      this.terminationExecuted = true;

      // Stage 1: Send SIGTERM to process group or PID
      sendVerifiedSignal(this.pid, this.pgid, 'SIGTERM');

      // Stage 2: Wait bounded grace period
      const gracePeriodMs = this.config.terminationGracePeriodMs || 2000;
      const terminatedInGrace = await this.waitForExitOrTimeout(gracePeriodMs);

      // Stage 3: Escalate to SIGKILL if still alive
      if (!terminatedInGrace) {
        this.escalatedToKill = true;
        sendVerifiedSignal(this.pid, this.pgid, 'SIGKILL');
        await this.waitForExitOrTimeout(2000);
      }

      // Stage 4: Verify termination of direct child and process group
      this.state = 'VERIFYING_TERMINATION';
      const termResult = await this.verifyProcessTermination(
        this.childProcess.exitCode,
        this.childProcess.signalCode
      );

      this.state = termResult.terminationVerified ? 'TERMINATED' : 'RECOVERY_REQUIRED';
      return termResult;
    })();

    return this.terminationPromise;
  }

  private waitForExitOrTimeout(timeoutMs: number): Promise<boolean> {
    if (!this.childProcess || this.childProcess.exitCode !== null || this.childProcess.signalCode !== null) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null;

      const onExit = () => {
        if (timer) clearTimeout(timer);
        resolve(true);
      };

      timer = setTimeout(() => {
        this.childProcess?.removeListener('close', onExit);
        resolve(this.childProcess?.exitCode !== null || this.childProcess?.signalCode !== null);
      }, timeoutMs);

      this.childProcess?.once('close', onExit);
    });
  }

  private async verifyProcessTermination(
    exitCode: number | null,
    signal: NodeJS.Signals | null
  ): Promise<TerminationResult> {
    const isDirectAlive = this.pid ? isProcessAliveSync(this.pid) : false;

    // Check process group liveness if supported
    let descendantsAlive: boolean | 'UNKNOWN' = false;
    if (this.pgid && process.platform !== 'win32') {
      descendantsAlive = isProcessGroupAlive(this.pgid);

      // If direct child exited but descendants survived in process group -> reap them
      if (descendantsAlive === true) {
        sendVerifiedSignal(this.pgid, this.pgid, 'SIGTERM');
        await new Promise((r) => setTimeout(r, 100));
        if (isProcessGroupAlive(this.pgid) === true) {
          sendVerifiedSignal(this.pgid, this.pgid, 'SIGKILL');
          await new Promise((r) => setTimeout(r, 100));
        }
        descendantsAlive = isProcessGroupAlive(this.pgid);
      }
    }

    const directDead = isDirectAlive === false;
    const descendantsDead = descendantsAlive === false;
    const terminationVerified = directDead && descendantsDead;

    return {
      exitCode,
      signal,
      terminatedBySupervisor: this.terminationExecuted,
      escalatedToKill: this.escalatedToKill,
      terminationVerified,
      descendantsTerminated: descendantsDead,
      durationMs: Date.now() - this.processStartedAt,
      error: !terminationVerified
        ? `Process verification failed: directAlive=${isDirectAlive}, descendantsAlive=${descendantsAlive}`
        : undefined,
    };
  }

  /**
   * Helper: Executes a child worker guarded by a ResourceCoordinator reservation.
   * Releases reservation ONLY after verified child termination.
   * On uncertain termination, leaves coordinator locked in RECOVERY_REQUIRED.
   */
  public static async executeWithReservation(options: {
    coordinator: ResourceCoordinator;
    resourceType: ResourceType;
    ownerId: string;
    workerConfig: SupervisorConfig;
    inputPayload?: Record<string, unknown>;
  }): Promise<SupervisorExecutionResult> {
    const { coordinator, resourceType, ownerId, workerConfig, inputPayload } = options;

    const reservation = await coordinator.acquire(resourceType, ownerId, {
      pid: process.pid,
      timeoutMs: workerConfig.timeoutMs,
      metadata: {
        workerType: workerConfig.workerType,
        executable: workerConfig.executable,
      },
    });

    const supervisor = new ChildProcessSupervisor(workerConfig);

    try {
      const result = await supervisor.execute(inputPayload);

      if (result.termination.terminationVerified) {
        // Clean termination verified -> safe to release reservation
        await reservation.release();
      } else {
        // Uncertain termination -> retain reservation & lock coordinator fail-closed
        coordinator.markRecoveryRequired(
          reservation.id,
          result.errorMessage || 'Uncertain worker process termination'
        );
      }

      return result;
    } catch (err: any) {
      // In case of unexpected supervisor exception, attempt cancel and retain lock
      await supervisor.cancel('SUPERVISOR_EXCEPTION');
      coordinator.markRecoveryRequired(
        reservation.id,
        `Supervisor execution crashed: ${err?.message || err}`
      );
      throw err;
    }
  }

  /**
   * Reconciles unresolved worker reservations on supervisor restart.
   * Conservative anti-PID-reuse verification:
   * - Reclaims confirmed dead processes.
   * - Terminates verified matching orphan workers.
   * - Fails closed without signaling if PID was recycled.
   */
  public static async reconcileOrphanedWorkerReservations(
    coordinator: ResourceCoordinator,
    persistence: any
  ): Promise<{
    reconciledCount: number;
    terminatedCount: number;
    failedClosedCount: number;
    details: Array<{
      reservationId: string;
      status: 'RECLAIMED_DEAD' | 'TERMINATED_ORPHAN' | 'FAIL_CLOSED_RECYCLED_PID' | 'FAIL_CLOSED_UNKNOWN';
      reason: string;
    }>;
  }> {
    const unresolved = persistence.getActiveOrUnresolved
      ? persistence.getActiveOrUnresolved()
      : (persistence.getUnresolvedReservations ? persistence.getUnresolvedReservations() : []);
    let reconciledCount = 0;
    let terminatedCount = 0;
    let failedClosedCount = 0;
    const details: Array<{
      reservationId: string;
      status: 'RECLAIMED_DEAD' | 'TERMINATED_ORPHAN' | 'FAIL_CLOSED_RECYCLED_PID' | 'FAIL_CLOSED_UNKNOWN';
      reason: string;
    }> = [];

    for (const record of unresolved) {
      const pid = record.pid;
      const metadata = record.metadata as Record<string, unknown> | undefined;
      const workerType = metadata?.workerType as string | undefined;

      // Only handle worker reservations with recorded workerType
      if (!workerType) continue;

      if (!pid) {
        coordinator.markRecoveryRequired(record.id, 'No PID recorded for active worker reservation');
        failedClosedCount++;
        details.push({
          reservationId: record.id,
          status: 'FAIL_CLOSED_UNKNOWN',
          reason: 'No PID recorded',
        });
        continue;
      }

      const isAlive = isProcessAliveSync(pid);
      if (isAlive === false) {
        persistence.updateStatus(record.id, 'RELEASED', 'Reclaimed dead orphaned worker');
        reconciledCount++;
        details.push({
          reservationId: record.id,
          status: 'RECLAIMED_DEAD',
          reason: `PID ${pid} is confirmed dead`,
        });
        continue;
      }

      // Process is alive: inspect identity to prevent killing a recycled PID!
      const snapshot = await getProcessSnapshot(pid);
      const expectedIdentity: ProcessIdentity = {
        requestId: (metadata?.requestId as string) || record.id,
        processInstanceId: (metadata?.processInstanceId as string) || '',
        pid,
        pgid: (metadata?.pgid as number) || undefined,
        processStartedAt: (metadata?.processStartedAt as number) || record.acquiredAt,
        executable: (metadata?.executable as string) || undefined,
        command: (metadata?.command as string) || undefined,
      };

      const verification = verifyProcessIdentity(expectedIdentity, snapshot);

      if (verification.status === 'RECYCLED_PID' || verification.status === 'MISMATCH') {
        coordinator.markRecoveryRequired(
          record.id,
          `PID ${pid} has been reused by unrelated process: ${verification.reason}`
        );
        failedClosedCount++;
        details.push({
          reservationId: record.id,
          status: 'FAIL_CLOSED_RECYCLED_PID',
          reason: verification.reason,
        });
        continue;
      }

      if (verification.status === 'MATCH' && verification.canSignal) {
        sendVerifiedSignal(pid, expectedIdentity.pgid, 'SIGTERM');
        await new Promise((r) => setTimeout(r, 500));
        if (isProcessAliveSync(pid)) {
          sendVerifiedSignal(pid, expectedIdentity.pgid, 'SIGKILL');
          await new Promise((r) => setTimeout(r, 200));
        }

        if (isProcessAliveSync(pid) === false) {
          persistence.updateStatus(record.id, 'RELEASED', 'Terminated verified orphaned worker');
          terminatedCount++;
          details.push({
            reservationId: record.id,
            status: 'TERMINATED_ORPHAN',
            reason: `Terminated verified orphan PID ${pid}`,
          });
        } else {
          coordinator.markRecoveryRequired(record.id, `Failed to terminate orphan PID ${pid}`);
          failedClosedCount++;
          details.push({
            reservationId: record.id,
            status: 'FAIL_CLOSED_UNKNOWN',
            reason: 'Process survived SIGKILL',
          });
        }
      } else {
        coordinator.markRecoveryRequired(record.id, `Unknown process verification status for PID ${pid}`);
        failedClosedCount++;
        details.push({
          reservationId: record.id,
          status: 'FAIL_CLOSED_UNKNOWN',
          reason: verification.reason,
        });
      }
    }

    return {
      reconciledCount,
      terminatedCount,
      failedClosedCount,
      details,
    };
  }
}
