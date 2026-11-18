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
  readonly pgidVerificationState?: 'UNVERIFIED' | 'OS_VERIFIED';
  readonly hasConflict?: boolean;
  readonly conflictReason?: string;
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

export interface ProcessGroupIdentityRecord {
  readonly pgid?: number;
  readonly pgidVerificationState: 'UNVERIFIED' | 'OS_VERIFIED';
  readonly source: 'WORKER_IDENTITY' | 'RESERVATION_METADATA' | 'NONE';
  readonly hasConflict: boolean;
  readonly conflictReason?: string;
}

/**
 * Atomically resolves PGID and its verification provenance from identity metadata.
 * Enforces Remediation A & Phase 2.3.3.1.12 invariants:
 * 1. A PGID must never inherit provenance from a different metadata source.
 * 2. Conflicting metadata across workerIdentity and reservation metadata strictly fails closed.
 * 3. Conflicting or malformed aliases within the same metadata source strictly fail closed.
 * 4. Incomplete sources (e.g. unanchored provenance without PGID) cannot pair with another source.
 * 5. Legacy records without explicit provenance remain UNVERIFIED.
 * 6. Invalid PGIDs (<=0, floats, NaN, non-integers) are rejected.
 */
export function resolveProcessGroupIdentity(
  workerIdentity?: { childPgid?: number | null; pgid?: number | null; pgidVerificationState?: 'UNVERIFIED' | 'OS_VERIFIED' | string } | null,
  meta?: { childPgid?: number | null; pgid?: number | null; pgidVerificationState?: 'UNVERIFIED' | 'OS_VERIFIED' | string } | null
): ProcessGroupIdentityRecord {
  function isPresent(val: unknown): boolean {
    return val !== undefined && val !== null;
  }

  function isValidPositiveInteger(val: unknown): val is number {
    return typeof val === 'number' && Number.isInteger(val) && val > 0;
  }

  // 1. Parse and validate workerIdentity candidate aliases (Phase 2.3.3.1.14)
  const rawWiChildPgid = workerIdentity?.childPgid;
  const rawWiPgid = (workerIdentity as any)?.pgid;
  const hasWiChildPgid = isPresent(rawWiChildPgid);
  const hasWiPgid = isPresent(rawWiPgid);

  let wiPgid: number | undefined;
  if (hasWiChildPgid && hasWiPgid) {
    const wiChildValid = isValidPositiveInteger(rawWiChildPgid);
    const wiPgidValid = isValidPositiveInteger(rawWiPgid);
    if (!wiChildValid || !wiPgidValid) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: 'Invalid metadata: malformed PGID alias in workerIdentity',
      };
    }
    if (rawWiChildPgid !== rawWiPgid) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: 'Conflicting workerIdentity PGID aliases: childPgid does not match pgid',
      };
    }
    wiPgid = rawWiChildPgid;
  } else if (hasWiChildPgid) {
    if (!isValidPositiveInteger(rawWiChildPgid)) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: 'Invalid metadata: malformed PGID alias in workerIdentity',
      };
    }
    wiPgid = rawWiChildPgid;
  } else if (hasWiPgid) {
    if (!isValidPositiveInteger(rawWiPgid)) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: 'Invalid metadata: malformed PGID alias in workerIdentity',
      };
    }
    wiPgid = rawWiPgid;
  }

  const wiState: 'UNVERIFIED' | 'OS_VERIFIED' =
    workerIdentity?.pgidVerificationState === 'OS_VERIFIED' ? 'OS_VERIFIED' : 'UNVERIFIED';
  const wiHasPgid = wiPgid !== undefined;

  // 2. Parse and validate reservation metadata candidate aliases (Phase 2.3.3.1.14)
  const rawMetaChildPgid = meta?.childPgid;
  const rawMetaPgid = meta?.pgid;
  const hasMetaChildPgid = isPresent(rawMetaChildPgid);
  const hasMetaPgid = isPresent(rawMetaPgid);

  let metaPgid: number | undefined;
  if (hasMetaChildPgid && hasMetaPgid) {
    const metaChildValid = isValidPositiveInteger(rawMetaChildPgid);
    const metaPgidValid = isValidPositiveInteger(rawMetaPgid);
    if (!metaChildValid || !metaPgidValid) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: 'Invalid metadata: malformed PGID alias in reservation metadata',
      };
    }
    if (rawMetaChildPgid !== rawMetaPgid) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: 'Conflicting metadata PGID aliases: childPgid does not match pgid',
      };
    }
    metaPgid = rawMetaChildPgid;
  } else if (hasMetaChildPgid) {
    if (!isValidPositiveInteger(rawMetaChildPgid)) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: 'Invalid metadata: malformed PGID alias in reservation metadata',
      };
    }
    metaPgid = rawMetaChildPgid;
  } else if (hasMetaPgid) {
    if (!isValidPositiveInteger(rawMetaPgid)) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: 'Invalid metadata: malformed PGID alias in reservation metadata',
      };
    }
    metaPgid = rawMetaPgid;
  }

  const metaState: 'UNVERIFIED' | 'OS_VERIFIED' =
    meta?.pgidVerificationState === 'OS_VERIFIED' ? 'OS_VERIFIED' : 'UNVERIFIED';
  const metaHasPgid = metaPgid !== undefined;

  // 3. Detect unanchored provenance without valid PGID (independent validation, Phase 2.3.3.1.14)
  if (meta?.pgidVerificationState === 'OS_VERIFIED' && !metaHasPgid) {
    return {
      pgid: undefined,
      pgidVerificationState: 'UNVERIFIED',
      source: 'NONE',
      hasConflict: true,
      conflictReason: 'Reservation metadata contains unanchored OS_VERIFIED provenance without valid PGID',
    };
  }

  if (workerIdentity?.pgidVerificationState === 'OS_VERIFIED' && !wiHasPgid) {
    return {
      pgid: undefined,
      pgidVerificationState: 'UNVERIFIED',
      source: 'NONE',
      hasConflict: true,
      conflictReason: 'Worker identity contains unanchored OS_VERIFIED provenance without valid PGID',
    };
  }

  // 4. Both sources define a PGID
  if (wiHasPgid && metaHasPgid) {
    if (wiPgid !== metaPgid) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: `Conflicting PGIDs: workerIdentity (${wiPgid}) does not match metadata (${metaPgid})`,
      };
    }

    if (wiState !== metaState) {
      return {
        pgid: undefined,
        pgidVerificationState: 'UNVERIFIED',
        source: 'NONE',
        hasConflict: true,
        conflictReason: `Conflicting provenance: workerIdentity is ${wiState} but metadata is ${metaState}`,
      };
    }

    return {
      pgid: wiPgid,
      pgidVerificationState: wiState,
      source: 'WORKER_IDENTITY',
      hasConflict: false,
    };
  }

  // 5. Only workerIdentity defines a PGID
  if (wiHasPgid && !metaHasPgid) {
    return {
      pgid: wiPgid,
      pgidVerificationState: wiState,
      source: 'WORKER_IDENTITY',
      hasConflict: false,
    };
  }

  // 6. Only reservation metadata defines a PGID
  if (!wiHasPgid && metaHasPgid) {
    return {
      pgid: metaPgid,
      pgidVerificationState: metaState,
      source: 'RESERVATION_METADATA',
      hasConflict: false,
    };
  }

  // 7. Neither source defines a valid PGID
  return {
    pgid: undefined,
    pgidVerificationState: 'UNVERIFIED',
    source: 'NONE',
    hasConflict: false,
  };
}

/**
 * Detailed POSIX process group inspection.
 * Distinguishes empty groups, zombie-only groups, and groups with active living execution.
 */
export async function checkProcessGroupLiveness(pgid: number | undefined): Promise<ProcessGroupLivenessState> {
  if (!pgid || pgid <= 0 || !Number.isInteger(pgid) || process.platform === 'win32') {
    return 'UNKNOWN';
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
  if (!pgid || pgid <= 0 || !Number.isInteger(pgid) || process.platform === 'win32') {
    return 'UNKNOWN';
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

export const MAX_SNAPSHOT_DIAGNOSTIC_LENGTH = 256;

/**
 * Safely formats a snapshot property value (such as state, PID, or PGID) for diagnostic output,
 * guaranteeing bounded length and preventing unhandled exceptions when encountering Symbols,
 * hostile objects, functions, or unprintable types.
 */
export function formatSnapshotState(value: unknown): string {
  try {
    if (typeof value === 'string') {
      if (value.length <= 64) {
        return value;
      }
      return value.slice(0, 60) + '...';
    }
    if (typeof value === 'symbol') {
      return 'Symbol';
    }
    if (typeof value === 'bigint') {
      return '[bigint]';
    }
    if (typeof value === 'function') {
      return '[function]';
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        return String(value).slice(0, 32);
      }
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }
    if (Array.isArray(value)) {
      return '[object]';
    }
    if (typeof value === 'object') {
      return '[object]';
    }
  } catch {
    return '[unprintable]';
  }
  return '[unprintable]';
}

/**
 * Enforces bounded maximum length on validator diagnostic reason strings.
 */
function clampDiagnostic(reason: string, maxLength: number = MAX_SNAPSHOT_DIAGNOSTIC_LENGTH): string {
  try {
    if (typeof reason !== 'string') {
      return 'Snapshot validation failed';
    }
    if (reason.length <= maxLength) {
      return reason;
    }
    return reason.slice(0, maxLength);
  } catch {
    return 'Snapshot validation failed';
  }
}

function makeInvalidResult(reason: string): { isValid: false; pgid: undefined; reason: string } {
  return {
    isValid: false,
    pgid: undefined,
    reason: clampDiagnostic(reason),
  };
}

/**
 * Strictly validates an OS process snapshot against the expected child process at spawn.
 * Enforces Remediation C and Phase 2.3.3.1.20 invariants:
 * Validates returned PID, PGID, and state eligibility.
 * All invalid outcomes return safe, bounded diagnostics (<= 256 chars) without throwing exceptions.
 */
export function validateSpawnSnapshot(
  expectedPid: number,
  snap: OSProcessSnapshot | null | undefined
): { isValid: boolean; pgid?: number; reason?: string } {
  try {
    if (!snap || typeof snap !== 'object') {
      return makeInvalidResult('Snapshot is missing or not an object');
    }

    let pid: unknown;
    let pgid: unknown;
    let state: unknown;
    try {
      pid = snap.pid;
      pgid = snap.pgid;
      state = snap.state;
    } catch {
      return makeInvalidResult('Snapshot properties could not be inspected');
    }

    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
      return makeInvalidResult(`Invalid snapshot PID: ${formatSnapshotState(pid)}`);
    }
    if (typeof pgid !== 'number' || !Number.isInteger(pgid) || pgid <= 0) {
      return makeInvalidResult(`Invalid snapshot PGID: ${formatSnapshotState(pgid)}`);
    }
    if (pid !== expectedPid) {
      return makeInvalidResult(`Snapshot PID ${pid} does not match expected PID ${expectedPid}`);
    }
    if (pgid !== expectedPid) {
      return makeInvalidResult(`Snapshot PGID ${pgid} does not match expected PID ${expectedPid}`);
    }
    if (state !== 'RUNNING' && state !== 'SLEEPING') {
      const detail = state === 'ZOMBIE'
        ? 'Snapshot process is already a zombie'
        : state === 'UNKNOWN'
        ? 'Snapshot process state is UNKNOWN'
        : `Snapshot process state '${formatSnapshotState(state)}' is not eligible for verification`;
      return makeInvalidResult(detail);
    }
    return { isValid: true, pgid: pgid as number };
  } catch {
    return makeInvalidResult('Snapshot validation failed');
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
  if (expected.hasConflict) {
    return {
      status: 'MISMATCH',
      isAlive: true,
      canSignal: false,
      reason: `Process identity metadata has conflict: ${expected.conflictReason || 'Conflicting PGID/provenance'}`,
      snapshot,
    };
  }

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

  // Mode B Process-Group Authorization Guard (Remediation B):
  // Strictly requires all 6 conditions:
  // 1. Valid positive integer PGID > 1
  // 2. Not win32
  // 3. opts.useProcessGroup === true
  // 4. opts.expectedIdentity?.pgidVerificationState === 'OS_VERIFIED'
  // 5. opts.expectedIdentity?.pgid === pgid
  // 6. opts.expectedIdentity?.hasConflict !== true
  const canAuthorizeGroup = Boolean(
    opts.useProcessGroup === true &&
    typeof pgid === 'number' &&
    Number.isInteger(pgid) &&
    pgid > 1 &&
    process.platform !== 'win32' &&
    opts.expectedIdentity?.pgidVerificationState === 'OS_VERIFIED' &&
    opts.expectedIdentity?.pgid === pgid &&
    opts.expectedIdentity?.hasConflict !== true
  );

  // Mode A Direct-Child Handle Guard:
  const hasOwnedChild = Boolean(
    opts.childProcess &&
    typeof opts.childProcess.pid === 'number' &&
    opts.childProcess.pid === pid &&
    opts.childProcess.exitCode === null &&
    opts.childProcess.signalCode === null
  );

  // Synchronous fail-closed checks for metadata conflicts and unauthorized group signaling
  if (opts.expectedIdentity?.hasConflict === true) {
    return makeResult({
      success: false,
      deliveredToGroup: false,
      error: `Process identity conflict: ${opts.expectedIdentity.conflictReason || 'Conflicting PGID/provenance'}`,
      identityStatus: 'MISMATCH',
    });
  }

  if (opts.useProcessGroup && !canAuthorizeGroup && !hasOwnedChild) {
    return makeResult({
      success: false,
      deliveredToGroup: false,
      error: `Process-group signaling unauthorized: PGID ${pgid ?? 'missing'} is not OS_VERIFIED or metadata has conflict`,
    });
  }

  // 2. Dispatch execution helper
  function doDispatch(): SendSignalResult {
    // Mode B: Process-group signaling (only if explicitly authorized)
    if (canAuthorizeGroup && pgid) {
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

    // Mode A: Direct-child handle signaling
    if (hasOwnedChild) {
      try {
        const delivered = opts.childProcess.kill(signal);
        if (delivered) {
          return { success: true, deliveredToGroup: false };
        }
      } catch {
        // Fall through to direct PID
      }
    }

    // Fail closed if process-group was explicitly requested without owned direct-child handle and group was unauthorized
    if (opts.useProcessGroup && !canAuthorizeGroup && !hasOwnedChild) {
      return {
        success: false,
        deliveredToGroup: false,
        error: `Process-group signaling unauthorized: PGID ${pgid ?? 'missing'} is not OS_VERIFIED or metadata has conflict`,
      };
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
      const isGroupTarget = canAuthorizeGroup && pgid && pgid > 1;
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
        const isOwnedGroup = canAuthorizeGroup && opts.expectedIdentity?.pgid === pgid;
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
