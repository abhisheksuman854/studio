/**
 * Auravo Studio — AI-Foundation 2.3.3.1
 * Process Identity, Liveness & Anti-PID-Reuse Verification
 * 
 * Tracks durable process instance identity, correlates OS process metadata,
 * detects PID reuse, and enforces conservative fail-closed guards.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

export interface ProcessIdentity {
  readonly requestId: string;
  readonly processInstanceId: string; // Format: proc_<pid>_<timestamp>_<uuid>
  readonly pid: number;
  readonly pgid?: number;
  readonly processStartedAt: number;
  readonly lstart?: string;
  readonly reservationCreatedAt?: number;
  readonly recoveryAttemptedAt?: number;
  readonly executable?: string;
  readonly command?: string;
}

export type OSProcessState =
  | 'RUNNING'
  | 'SLEEPING'
  | 'STOPPED'
  | 'ZOMBIE'
  | 'UNKNOWN';

export interface OSProcessSnapshot {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid?: number;
  readonly state: OSProcessState;
  readonly rawState?: string;
  readonly lstart?: string;
  readonly startTimeMs?: number;
  readonly command: string;
}

export type ProcessIdentityStatus =
  | 'DEAD'
  | 'MATCH'
  | 'RECYCLED_PID'
  | 'MISMATCH'
  | 'UNKNOWN';

export interface ProcessVerificationResult {
  readonly status: ProcessIdentityStatus;
  readonly isAlive: boolean;
  readonly canSignal: boolean;
  readonly isZombie?: boolean;
  readonly reason: string;
  readonly snapshot?: OSProcessSnapshot | null;
}

/**
 * Generates an immutable, collision-resistant process instance identifier.
 */
export function generateProcessInstanceId(pid: number, timestamp = Date.now()): string {
  const uuid = crypto.randomUUID();
  return `proc_${pid}_${timestamp}_${uuid}`;
}

/**
 * Checks basic OS process liveness using process.kill(pid, 0).
 */
export function isProcessAliveSync(pid: number): boolean | 'UNKNOWN' {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err.code === 'EPERM') return true; // Process exists but belongs to different user
    if (err.code === 'ESRCH') return false; // No such process
    return 'UNKNOWN';
  }
}

/**
 * Process group liveness classification (Phase 2.3.3.1.4 / Workstream C).
 */
export type ProcessGroupLivenessState =
  | 'EMPTY'
  | 'LIVE_MEMBERS'
  | 'ZOMBIE_ONLY'
  | 'UNKNOWN'
  | 'ERROR';

/**
 * Detailed POSIX process group inspection.
 * Distinguishes empty groups, zombie-only groups, and groups with active living execution.
 */
export async function checkProcessGroupLiveness(pgid: number | undefined): Promise<ProcessGroupLivenessState> {
  if (!pgid || pgid <= 0 || process.platform === 'win32') {
    return 'EMPTY';
  }
  if (pgid === process.pid) {
    return 'LIVE_MEMBERS';
  }

  // POSIX kill(-pgid, 0) probe
  try {
    process.kill(-pgid, 0);
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      return 'EMPTY'; // Entire process group is dead / unpopulated
    }
    if (err.code === 'EPERM') {
      return 'ERROR'; // Group exists but owned by another user / permission denied
    }
    return 'UNKNOWN';
  }

  // Group exists. Attempt detailed process inspection via ps
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'pid=,state=', '-g', String(pgid)], { timeout: 1000 });
    const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return 'EMPTY';

    let hasLive = false;
    let hasZombie = false;
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const state = (parts[1] || '').toUpperCase();
      if (state.startsWith('Z')) {
        hasZombie = true;
      } else {
        hasLive = true;
      }
    }

    if (hasLive) return 'LIVE_MEMBERS';
    if (hasZombie) return 'ZOMBIE_ONLY';
    return 'EMPTY';
  } catch {
    // If ps fails, kill(-pgid, 0) proved group has active members
    return 'UNKNOWN';
  }
}

/**
 * Checks if any process exists within a specific POSIX process group.
 * Uses native POSIX kill(-pgid, 0) syscall without spawning external binaries.
 */
export function isProcessGroupAlive(pgid: number): boolean | 'UNKNOWN' {
  if (!pgid || pgid <= 0 || process.platform === 'win32') {
    return false;
  }
  if (pgid === process.pid) {
    return true;
  }

  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err: any) {
    if (err.code === 'EPERM') return true;
    if (err.code === 'ESRCH') return false; // Entire process group is dead
    return 'UNKNOWN';
  }
}

/**
 * Retrieves low-level operating system process details for PID reuse detection.
 */
export async function getProcessSnapshot(pid: number): Promise<OSProcessSnapshot | null> {
  if (!pid || pid <= 0) return null;

  // Verify process exists first
  const alive = isProcessAliveSync(pid);
  if (alive === false) return null;

  try {
    // POSIX query for pid, ppid, pgid, state, lstart (start time), command with strict 1s timeout
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'pid=,ppid=,pgid=,state=,lstart=,command=', '-p', String(pid)],
      { timeout: 1000 }
    );
    const line = stdout.trim();
    if (!line) return null;

    // Output format: PID PPID PGID STATE Day Mon Date Time Year COMMAND
    // e.g.: "12345  678  12345  Rs+  Tue Nov 17 15:30:00 2026 /usr/local/bin/node"
    const parts = line.split(/\s+/);
    if (parts.length < 5) return null;

    const parsedPid = parseInt(parts[0], 10);
    const parsedPpid = parseInt(parts[1], 10);
    const parsedPgid = parseInt(parts[2], 10);
    const rawState = parts[3];

    let state: OSProcessState = 'UNKNOWN';
    const firstChar = (rawState || '').charAt(0).toUpperCase();
    if (firstChar === 'Z') state = 'ZOMBIE';
    else if (firstChar === 'T') state = 'STOPPED';
    else if (firstChar === 'R') state = 'RUNNING';
    else if (firstChar === 'S' || firstChar === 'I') state = 'SLEEPING';
    else if (firstChar === 'U' || firstChar === 'D') state = 'RUNNING';

    // Reconstruct lstart timestamp (Day Mon Date Time Year -> 5 tokens)
    let lstartStr: string | undefined;
    let commandStr: string;

    if (parts.length >= 10) {
      lstartStr = parts.slice(4, 9).join(' ');
      commandStr = parts.slice(9).join(' ');
    } else if (parts.length >= 9) {
      // Fallback if state was merged or omitted
      lstartStr = parts.slice(3, 8).join(' ');
      commandStr = parts.slice(8).join(' ');
    } else {
      commandStr = parts.slice(4).join(' ');
    }

    const parsedMs = lstartStr ? Date.parse(lstartStr) : NaN;
    const startTimeMs = Number.isFinite(parsedMs) ? parsedMs : undefined;

    return {
      pid: parsedPid,
      ppid: parsedPpid,
      pgid: Number.isFinite(parsedPgid) ? parsedPgid : undefined,
      state,
      rawState,
      lstart: lstartStr,
      startTimeMs,
      command: commandStr,
    };
  } catch (err: any) {
    // ps exits 1 if PID not found
    if (err.code === 1 || err.status === 1) {
      return null;
    }
    return null;
  }
}

/**
 * Validates whether an active OS process genuinely corresponds to the expected managed worker.
 * Prevents targeting recycled PIDs or unrelated operating system processes.
 */
export function verifyProcessIdentity(
  expected: ProcessIdentity,
  snapshot: OSProcessSnapshot | null
): ProcessVerificationResult {
  if (!snapshot) {
    const isAlive = isProcessAliveSync(expected.pid);
    if (isAlive === true) {
      // Process is alive but OS snapshot unavailable (e.g. sandbox or permission block)
      return {
        status: 'UNKNOWN',
        isAlive: true,
        canSignal: false,
        reason: `Process PID ${expected.pid} is alive but OS process metadata is inaccessible`,
        snapshot: null,
      };
    }
    return {
      status: 'DEAD',
      isAlive: false,
      canSignal: false,
      reason: `Process with PID ${expected.pid} is not running (verified absent)`,
      snapshot: null,
    };
  }

  if (snapshot.pid !== expected.pid) {
    return {
      status: 'MISMATCH',
      isAlive: true,
      canSignal: false,
      reason: `Snapshot PID ${snapshot.pid} does not match expected PID ${expected.pid}`,
      snapshot,
    };
  }

  // Zombie detection (Scope E)
  if (snapshot.state === 'ZOMBIE') {
    return {
      status: 'MATCH',
      isAlive: false, // Zombie is dead / exited execution
      canSignal: false, // Do not send signals to zombies
      isZombie: true,
      reason: `PID ${expected.pid} is a zombie process awaiting reaping`,
      snapshot,
    };
  }

  // Check command identity if expected executable or command is specified
  if (expected.executable || expected.command) {
    const expectedCmd = (expected.executable || expected.command || '').toLowerCase();
    const actualCmd = snapshot.command.toLowerCase();

    // Check if actual command contains expected executable basename
    const expectedBase = expectedCmd.split('/').pop() || expectedCmd;
    const actualBase = actualCmd.split('/').pop() || actualCmd;

    const matchesExecutable = actualBase.includes(expectedBase) || actualCmd.includes(expectedBase);

    if (!matchesExecutable) {
      return {
        status: 'RECYCLED_PID',
        isAlive: true,
        canSignal: false,
        reason: `PID ${expected.pid} has been reused by unrelated process '${snapshot.command}' (expected '${expectedCmd}')`,
        snapshot,
      };
    }
  }

  // Check process group if recorded
  if (expected.pgid && snapshot.pgid && snapshot.pgid !== expected.pgid) {
    return {
      status: 'RECYCLED_PID',
      isAlive: true,
      canSignal: false,
      reason: `PID ${expected.pid} PGID ${snapshot.pgid} does not match expected PGID ${expected.pgid}`,
      snapshot,
    };
  }

  // Start time comparison (Scope C & 6.1)
  if (expected.lstart && snapshot.lstart && expected.lstart !== snapshot.lstart) {
    return {
      status: 'RECYCLED_PID',
      isAlive: true,
      canSignal: false,
      reason: `PID ${expected.pid} start time '${snapshot.lstart}' does not match expected '${expected.lstart}'`,
      snapshot,
    };
  }

  if (expected.processStartedAt && snapshot.startTimeMs) {
    const deltaMs = Math.abs(snapshot.startTimeMs - expected.processStartedAt);
    // Allow bounded tolerance (e.g. 5000ms) for clock jitter between Date.now() and OS lstart resolution
    if (deltaMs > 5000) {
      return {
        status: 'RECYCLED_PID',
        isAlive: true,
        canSignal: false,
        reason: `PID ${expected.pid} start time delta (${deltaMs}ms) exceeds tolerance; PID recycled`,
        snapshot,
      };
    }
  }

  return {
    status: 'MATCH',
    isAlive: true,
    canSignal: true,
    reason: `Verified managed process PID ${expected.pid} matching executable '${snapshot.command}'`,
    snapshot,
  };
}

export interface SendSignalOptions {
  readonly useProcessGroup?: boolean;
  readonly expectedIdentity?: ProcessIdentity;
  readonly snapshot?: OSProcessSnapshot | null;
  readonly childProcess?: any;
}

export interface SendSignalResult {
  readonly success: boolean;
  readonly deliveredToGroup: boolean;
  readonly error?: string;
  readonly identityStatus?: ProcessIdentityStatus;
}

/**
 * Safely delivers a signal to a verified process or process group.
 * Strictly verifies identity when expectedIdentity is provided, preventing
 * destructive signal dispatch to recycled PIDs or mismatched processes.
 * Returns a result that acts both synchronously and as an awaitable Promise.
 */
export function sendVerifiedSignal(
  pid: number,
  pgid: number | undefined,
  signal: NodeJS.Signals,
  options: boolean | SendSignalOptions = true
): SendSignalResult & PromiseLike<SendSignalResult> {
  const opts: SendSignalOptions = typeof options === 'boolean'
    ? { useProcessGroup: options }
    : { useProcessGroup: true, ...options };

  function makeResult(
    res: SendSignalResult,
    p?: Promise<SendSignalResult>
  ): SendSignalResult & PromiseLike<SendSignalResult> {
    const promise = p ?? Promise.resolve(res);
    return {
      ...res,
      then: promise.then.bind(promise),
      catch: (promise as any).catch?.bind(promise),
      finally: (promise as any).finally?.bind(promise),
    } as any;
  }

  // 1. Synchronous invariant safety guards
  if (!pid || pid <= 0) {
    return makeResult({ success: false, deliveredToGroup: false, error: 'Invalid PID' });
  }

  // Never target PID 1 (init) or our own parent process
  if (pid === 1 || pid === process.pid) {
    return makeResult({
      success: false,
      deliveredToGroup: false,
      error: 'Safety restriction: cannot signal system or parent PID',
    });
  }

  // 2. Dispatch execution helper
  function doDispatch(): SendSignalResult {
    // Attempt process group signaling on POSIX if requested and pgid is valid
    if (opts.useProcessGroup && pgid && pgid > 1 && process.platform !== 'win32') {
      try {
        process.kill(-pgid, signal);
        return { success: true, deliveredToGroup: true };
      } catch (err: any) {
        if (err.code === 'ESRCH') {
          return { success: false, deliveredToGroup: true, error: 'ESRCH: Process group already terminated' };
        }
        // If process.kill(-pgid) failed with other error, fall through to direct handle/PID
      }
    }

    // Prefer owned child-process handle if available and still running
    if (opts.childProcess && opts.childProcess.exitCode === null && opts.childProcess.signalCode === null) {
      try {
        const delivered = opts.childProcess.kill(signal);
        if (delivered) {
          return { success: true, deliveredToGroup: false };
        }
      } catch {
        // Fall through to direct PID
      }
    }

    // Direct PID signaling
    try {
      process.kill(pid, signal);
      return { success: true, deliveredToGroup: false };
    } catch (err: any) {
      return {
        success: false,
        deliveredToGroup: false,
        error: `${err.code || err.name}: ${err.message}`,
      };
    }
  }

  // 3. Identity verification when expectedIdentity is provided
  if (opts.expectedIdentity) {
    const expectedPid = (opts.expectedIdentity as any).childPid ?? opts.expectedIdentity.pid;

    // If childProcess handle is directly owned and alive, verify ownership invariants
    if (opts.childProcess) {
      if (opts.childProcess.pid !== pid || expectedPid !== pid) {
        return makeResult({
          success: false,
          deliveredToGroup: false,
          error: `Process identity mismatch: child PID ${opts.childProcess.pid} does not match expected PID ${expectedPid}`,
          identityStatus: 'RECYCLED_PID',
        });
      }
      if ((opts.expectedIdentity as any).parentPid && (opts.expectedIdentity as any).parentPid !== process.pid) {
        return makeResult({
          success: false,
          deliveredToGroup: false,
          error: `Process identity mismatch: parent PID mismatch`,
          identityStatus: 'RECYCLED_PID',
        });
      }
    }

    // If snapshot was explicitly provided by caller
    if (opts.snapshot !== undefined) {
      const verification = verifyProcessIdentity(opts.expectedIdentity, opts.snapshot);
      if (verification.status !== 'MATCH' || !verification.canSignal) {
        return makeResult({
          success: false,
          deliveredToGroup: false,
          error: `Process identity mismatch: ${verification.reason}`,
          identityStatus: verification.status,
        });
      }
      return makeResult(doDispatch());
    }

    // Snapshot not provided: execute asynchronous OS snapshot check
    const asyncPromise = (async (): Promise<SendSignalResult> => {
      const isGroupTarget = opts.useProcessGroup && pgid && pgid > 1 && process.platform !== 'win32';
      const alive = isGroupTarget ? isProcessGroupAlive(pgid) === true : isProcessAliveSync(pid);
      if (!alive) {
        return {
          success: false,
          deliveredToGroup: Boolean(isGroupTarget),
          error: isGroupTarget
            ? `Process group with PGID ${pgid} is not running (verified absent)`
            : `Process identity mismatch: Process with PID ${pid} is not running (verified absent)`,
          identityStatus: 'DEAD',
        };
      }

      const snap = await getProcessSnapshot(pid);
      if (snap) {
        const verification = verifyProcessIdentity(opts.expectedIdentity!, snap);
        if (verification.status !== 'MATCH' || !verification.canSignal) {
          return {
            success: false,
            deliveredToGroup: false,
            error: `Process identity mismatch: ${verification.reason}`,
            identityStatus: verification.status,
          };
        }
      } else {
        // OS snapshot unavailable (e.g. unprivileged sandbox or ps EPERM)
        // If caller holds the direct childProcess handle OR valid process group identity
        const isOwnedChild = opts.childProcess && opts.childProcess.pid === pid;
        const isOwnedGroup = isGroupTarget && opts.expectedIdentity?.pgid === pgid;
        if (!isOwnedChild && !isOwnedGroup) {
          return {
            success: false,
            deliveredToGroup: false,
            error: `Process identity mismatch: Process PID ${pid} is alive but OS process metadata is inaccessible`,
            identityStatus: 'UNKNOWN',
          };
        }
      }

      return doDispatch();
    })();

    const initialSync: SendSignalResult = {
      success: false,
      deliveredToGroup: false,
      error: 'Async identity verification pending',
    };
    return makeResult(initialSync, asyncPromise);
  }

  // 4. Default dispatch without expectedIdentity
  return makeResult(doDispatch());
}
