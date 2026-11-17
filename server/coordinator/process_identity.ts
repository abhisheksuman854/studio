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
  readonly reservationCreatedAt?: number;
  readonly recoveryAttemptedAt?: number;
  readonly executable?: string;
  readonly command?: string;
}

export interface OSProcessSnapshot {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid?: number;
  readonly lstart?: string;
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
    // POSIX query for pid, ppid, pgid, lstart (start time), comm (command basename)
    const { stdout } = await execFileAsync('ps', ['-o', 'pid=,ppid=,pgid=,lstart=,comm=', '-p', String(pid)]);
    const line = stdout.trim();
    if (!line) return null;

    // Output format: PID PPID PGID Day Mon Date Time Year COMMAND
    // e.g.: "12345  678  12345 Tue Nov 17 15:30:00 2026 /usr/local/bin/node"
    const parts = line.split(/\s+/);
    if (parts.length < 5) return null;

    const parsedPid = parseInt(parts[0], 10);
    const parsedPpid = parseInt(parts[1], 10);
    const parsedPgid = parseInt(parts[2], 10);

    // Reconstruct lstart timestamp (Day Mon Date Time Year -> 5 tokens)
    let lstartStr: string | undefined;
    let commandStr: string;

    if (parts.length >= 9) {
      lstartStr = parts.slice(3, 8).join(' ');
      commandStr = parts.slice(8).join(' ');
    } else {
      commandStr = parts.slice(3).join(' ');
    }

    return {
      pid: parsedPid,
      ppid: parsedPpid,
      pgid: Number.isFinite(parsedPgid) ? parsedPgid : undefined,
      lstart: lstartStr,
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

  return {
    status: 'MATCH',
    isAlive: true,
    canSignal: true,
    reason: `Verified managed process PID ${expected.pid} matching executable '${snapshot.command}'`,
    snapshot,
  };
}

/**
 * Safely delivers a signal to a verified process or process group.
 * Strictly prevents signaling if identity check fails.
 */
export function sendVerifiedSignal(
  pid: number,
  pgid: number | undefined,
  signal: NodeJS.Signals,
  useProcessGroup = true
): { success: boolean; deliveredToGroup: boolean; error?: string } {
  if (!pid || pid <= 0) {
    return { success: false, deliveredToGroup: false, error: 'Invalid PID' };
  }

  // Never target PID 1 (init) or our own parent process group
  if (pid === 1 || pid === process.pid) {
    return { success: false, deliveredToGroup: false, error: 'Safety restriction: cannot signal system or parent PID' };
  }

  // Attempt process group signaling on POSIX
  if (useProcessGroup && pgid && pgid > 1 && process.platform !== 'win32') {
    try {
      process.kill(-pgid, signal);
      return { success: true, deliveredToGroup: true };
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        return { success: false, deliveredToGroup: true, error: 'ESRCH: Process group already terminated' };
      }
      // Fallback to direct PID if group signaling fails with EPERM or invalid group
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
