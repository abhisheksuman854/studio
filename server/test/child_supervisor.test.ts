/**
 * Auravo Studio — AI-Foundation 2.3.3.1
 * Child Process Supervisor, Worker Protocol & Lifecycle Safety Test Suite
 * 
 * Deterministic tests covering:
 * - Versioned protocol parsing & runtime validation
 * - Message correlation, duplicate prevention, and redaction
 * - Process identity & anti-PID-reuse verification
 * - Process group isolation and descendant termination
 * - Graceful SIGTERM and SIGKILL escalation ladders
 * - Fail-closed ResourceCoordinator integration
 * - Restart and orphan recovery
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORKER_PROTOCOL_VERSION,
  parseWorkerMessage,
  serializeWorkerMessage,
  sanitizeDiagnostic,
} from '../coordinator/worker_protocol.js';
import {
  generateProcessInstanceId,
  isProcessAliveSync,
  getProcessSnapshot,
  verifyProcessIdentity,
  sendVerifiedSignal,
  type ProcessIdentity,
} from '../coordinator/process_identity.js';
import {
  ChildProcessSupervisor,
  ALLOWED_EXECUTABLES,
} from '../coordinator/child_supervisor.js';
import { ResourceCoordinator } from '../coordinator/coordinator.js';
import { SQLitePersistenceAdapter } from '../coordinator/persistence.js';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUMMY_DIR = path.resolve(__dirname, '../coordinator/dummy_workers');

function getWorkerPath(workerName: string): string {
  return path.join(DUMMY_DIR, workerName);
}

function createInMemoryCoordinator() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS resource_reservations (
      id TEXT PRIMARY KEY,
      resourceType TEXT NOT NULL,
      ownerId TEXT NOT NULL,
      status TEXT NOT NULL,
      pid INTEGER,
      acquiredAt INTEGER NOT NULL,
      lastHeartbeatAt INTEGER NOT NULL,
      releasedAt INTEGER,
      failureReason TEXT,
      metadata TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });
  return { coordinator, persistence, db };
}

// ============================================================================
// 1. WORKER PROTOCOL & MESSAGE VALIDATION (Scope A)
// ============================================================================

test('1. Protocol validation: valid START message is correctly parsed', () => {
  const raw = JSON.stringify({
    type: 'START',
    version: '1.0',
    requestId: 'req_123',
    workerType: 'DUMMY_WORKER',
    pid: 12345,
    timestamp: Date.now(),
    metadata: { test: true },
  });

  const result = parseWorkerMessage(raw, 'req_123');
  assert.equal(result.success, true);
  assert.equal(result.message?.type, 'START');
  assert.equal(result.message?.version, '1.0');
  assert.equal(result.message?.requestId, 'req_123');
});

test('2. Protocol validation: unsupported protocol version is strictly rejected', () => {
  const raw = JSON.stringify({
    type: 'START',
    version: '2.0', // Unsupported version
    requestId: 'req_123',
    workerType: 'DUMMY_WORKER',
    pid: 12345,
    timestamp: Date.now(),
  });

  const result = parseWorkerMessage(raw, 'req_123');
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'UNSUPPORTED_VERSION');
  assert.match(result.errorMessage || '', /Unsupported worker protocol version/);
});

test('3. Protocol validation: malformed JSON lines are safely caught without crashing', () => {
  const raw = '{ not_valid_json: true ';
  const result = parseWorkerMessage(raw);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'MALFORMED_JSON');
});

test('4. Protocol validation: empty lines return EMPTY_LINE error', () => {
  const result = parseWorkerMessage('   \n');
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'EMPTY_LINE');
});

test('5. Protocol validation: oversized lines are rejected before unbounded parsing', () => {
  const hugeLine = '{"type":"START",' + 'A'.repeat(5000);
  const result = parseWorkerMessage(hugeLine, 'req_123', 1000); // 1KB limit
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'OVERSIZED_MESSAGE');
});

test('6. Protocol validation: mismatched requestId is rejected for request correlation', () => {
  const raw = JSON.stringify({
    type: 'SUCCESS',
    version: '1.0',
    requestId: 'req_INTRUDER',
    output: { done: true },
    durationMs: 10,
    timestamp: Date.now(),
  });

  const result = parseWorkerMessage(raw, 'req_LEGIT');
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'REQUEST_ID_MISMATCH');
});

test('7. Protocol validation: message serialization produces valid newline-terminated JSON', () => {
  const msg: any = {
    type: 'SUCCESS',
    version: '1.0',
    requestId: 'req_ser_test',
    output: { val: 42 },
    durationMs: 100,
    timestamp: 1234567890,
  };
  const serialized = serializeWorkerMessage(msg);
  assert.ok(serialized.endsWith('\n'));
  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed, msg);
});

test('8. Diagnostic Redaction: sensitive tokens, passwords, and file paths are redacted', () => {
  const rawError = 'Failed to connect: Bearer sk-antigravity-998877665544 with secret_key=superpassword123 at /Users/abhisheksuman/studio/file.txt';
  const redacted = sanitizeDiagnostic(rawError);

  assert.ok(!redacted.includes('sk-antigravity-998877665544'));
  assert.ok(!redacted.includes('superpassword123'));
  assert.ok(!redacted.includes('/Users/abhisheksuman/'));
  assert.ok(redacted.includes('[REDACTED_TOKEN]'));
  assert.ok(redacted.includes('[REDACTED]'));
  assert.ok(redacted.includes('/Users/[USER]/'));
});

// ============================================================================
// 2. PROCESS IDENTITY & ANTI-PID-REUSE PROTECTIONS (Scope B)
// ============================================================================

test('9. Process Identity: generates durable UUID-v4 correlation identifier', () => {
  const id1 = generateProcessInstanceId(process.pid);
  const id2 = generateProcessInstanceId(process.pid);
  assert.match(id1, /^proc_\d+_\d+_[a-f0-9\-]{36}$/);
  assert.notEqual(id1, id2);
});

test('10. Process Identity: verifies process identity matching and sandboxed fallback', async () => {
  const snapshot = await getProcessSnapshot(process.pid);
  if (snapshot !== null) {
    // When ps is accessible, verifies exact live match
    assert.equal(snapshot.pid, process.pid);
    const expected: ProcessIdentity = {
      requestId: 'req_self',
      processInstanceId: generateProcessInstanceId(process.pid),
      pid: process.pid,
      pgid: snapshot.pgid,
      processStartedAt: Date.now() - 10000,
      executable: 'node',
    };
    const verification = verifyProcessIdentity(expected, snapshot);
    assert.equal(verification.status, 'MATCH');
    assert.equal(verification.isAlive, true);
    assert.equal(verification.canSignal, true);
  } else {
    // When ps is inaccessible (e.g. sandbox seatbelt policy), verifies fail-closed security:
    // A live process whose OS snapshot is inaccessible evaluates to UNKNOWN and canSignal is FALSE!
    const expected: ProcessIdentity = {
      requestId: 'req_self',
      processInstanceId: generateProcessInstanceId(process.pid),
      pid: process.pid,
      processStartedAt: Date.now() - 10000,
      executable: 'node',
    };
    const verification = verifyProcessIdentity(expected, null);
    assert.equal(verification.status, 'UNKNOWN');
    assert.equal(verification.isAlive, true);
    assert.equal(verification.canSignal, false); // CANNOT SIGNAL ON UNKNOWN
  }
});

test('11. Anti-PID-Reuse: detects recycled PID when executable command mismatches', () => {
  const fakeSnapshot = {
    pid: 99999,
    ppid: 1,
    pgid: 99999,
    state: 'RUNNING' as const,
    lstart: 'Tue Nov 17 12:00:00 2026',
    command: '/usr/bin/unrelated_daemon', // Unrelated process that inherited PID
  };

  const expected: ProcessIdentity = {
    requestId: 'req_old_worker',
    processInstanceId: 'proc_99999_123_abc',
    pid: 99999,
    pgid: 99999,
    processStartedAt: Date.now() - 50000,
    executable: 'python3', // Expected python worker
    command: 'python3 worker.py',
  };

  const verification = verifyProcessIdentity(expected, fakeSnapshot);
  assert.equal(verification.status, 'RECYCLED_PID');
  assert.equal(verification.canSignal, false); // CRITICAL: NEVER SIGNAL RECYCLED PID
  assert.match(verification.reason, /PID 99999 has been reused/);
});

test('12. Anti-PID-Reuse: confirmed dead process returns DEAD status', () => {
  const expected: ProcessIdentity = {
    requestId: 'req_dead',
    processInstanceId: 'proc_dead_123',
    pid: 99999999, // Unlikely to exist
    processStartedAt: Date.now() - 10000,
  };

  const verification = verifyProcessIdentity(expected, null);
  assert.equal(verification.status, 'DEAD');
  assert.equal(verification.isAlive, false);
  assert.equal(verification.canSignal, false);
});

test('13. Safe Signal Dispatch: blocks signaling parent or init PID', () => {
  const initResult = sendVerifiedSignal(1, 1, 'SIGTERM');
  assert.equal(initResult.success, false);
  assert.match(initResult.error || '', /Safety restriction/);

  const parentResult = sendVerifiedSignal(process.pid, undefined, 'SIGTERM');
  assert.equal(parentResult.success, false);
  assert.match(parentResult.error || '', /Safety restriction/);
});

// ============================================================================
// 3. CHILD PROCESS SUPERVISOR & DUMMY WORKERS (Scope B, C, F)
// ============================================================================

test('14. Dummy Worker 1 (Immediate Success): runs to completion and emits output', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('immediate_success.js')],
  });

  const result = await supervisor.execute();
  assert.equal(result.success, true);
  assert.equal(result.state, 'TERMINATED');
  assert.equal(result.output?.status, 'COMPLETED');
  assert.equal(result.output?.qualityScore, 99);
  assert.equal(result.termination.terminationVerified, true);
  assert.equal(result.termination.exitCode, 0);
});

test('15. Dummy Worker 2 (Structured Failure): emits structured ERROR and fails cleanly', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('structured_failure.js')],
  });

  const result = await supervisor.execute();
  assert.equal(result.success, false);
  assert.equal(result.state, 'FAILED');
  assert.equal(result.errorCategory, 'EXECUTION_FAILED');
  assert.match(result.errorMessage || '', /planned failure/);
  assert.equal(result.termination.terminationVerified, true);
  assert.equal(result.termination.exitCode, 1);
});

test('16. Dummy Worker 3 (Malformed Protocol): invalid lines emit protocol_error without crashing', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('malformed_protocol.js')],
  });

  let errorEmitted = false;
  supervisor.on('protocol_error', () => {
    errorEmitted = true;
  });

  const result = await supervisor.execute();
  assert.equal(result.success, false);
  assert.equal(result.errorCategory, 'PROTOCOL_ERROR');
  assert.equal(errorEmitted, true);
  assert.equal(result.termination.terminationVerified, true);
});

test('17. Dummy Worker 4 (Unsupported Version): rejects version 99.0 fail-closed', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('unsupported_version.js')],
  });

  let unsupportedError = false;
  supervisor.on('protocol_error', (e) => {
    if (e.errorCode === 'UNSUPPORTED_VERSION') unsupportedError = true;
  });

  const result = await supervisor.execute();
  assert.equal(result.success, false);
  assert.equal(unsupportedError, true);
  assert.equal(result.state, 'FAILED');
});

test('18. Dummy Worker 5 (Oversized Output): line > 1MB terminates with OVERSIZED_MESSAGE', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('oversized_output.js')],
    maxStdoutBufferBytes: 1024 * 512, // 512 KB limit
  });

  const result = await supervisor.execute();
  assert.equal(result.success, false);
  assert.ok(result.errorCategory === 'PROTOCOL_ERROR' || result.errorCategory === 'CANCELLED');
  assert.match(result.errorMessage || '', /OVERSIZED_MESSAGE/);
});

test('19. Dummy Worker 6 (Delayed Response): emits PROGRESS events and finishes', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('delayed_response.js')],
    timeoutMs: 5000,
  });

  let progressCaptured: any = null;
  supervisor.on('worker_progress', (p) => {
    progressCaptured = p;
  });

  const result = await supervisor.execute();
  assert.equal(result.success, true);
  assert.equal(progressCaptured?.stage, 'HALFWAY_THERE');
  assert.equal(progressCaptured?.percent, 50);
  assert.equal(result.output?.completed, true);
});

test('20. Dummy Worker 7 (Infinite Process & Timeout): hard timeout triggers cancellation', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('infinite_process.js')],
    timeoutMs: 300, // Trigger timeout after 300ms
    terminationGracePeriodMs: 200,
  });

  const result = await supervisor.execute();
  assert.equal(result.success, false);
  assert.equal(result.errorCategory, 'TIMEOUT');
  assert.equal(result.termination.terminatedBySupervisor, true);
  assert.equal(result.termination.terminationVerified, true);
});

test('21. Dummy Worker 8 (Handles SIGTERM): graceful exit within grace period', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('handles_sigterm.js')],
    terminationGracePeriodMs: 1000,
  });

  let shutdownAckSeen = false;
  supervisor.on('worker_shutdown_ack', () => {
    shutdownAckSeen = true;
  });

  const execPromise = supervisor.execute();

  // Give child time to spawn and enter infinite loop
  await new Promise((r) => setTimeout(r, 150));

  // Cancel explicitly
  await supervisor.cancel('USER_CANCELLED');
  const result = await execPromise;

  assert.equal(result.termination.terminatedBySupervisor, true);
  assert.equal(result.termination.escalatedToKill, false); // Did NOT need SIGKILL
  assert.equal(result.termination.terminationVerified, true);
  assert.equal(shutdownAckSeen, true);
});

test('22. Dummy Worker 9 (Ignores SIGTERM): escalates to SIGKILL and terminates', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('ignores_sigterm.js')],
    terminationGracePeriodMs: 250, // Short grace period before SIGKILL
  });

  const execPromise = supervisor.execute();
  await new Promise((r) => setTimeout(r, 150));

  await supervisor.cancel('FORCE_CANCEL');
  const result = await execPromise;

  assert.equal(result.termination.terminatedBySupervisor, true);
  assert.equal(result.termination.escalatedToKill, true); // MUST escalate to SIGKILL
  assert.equal(result.termination.terminationVerified, true);
});

test('23. Dummy Worker 10 (Spawns Managed Child): process group signaling cleans entire group', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('spawns_managed_child.js')],
    terminationGracePeriodMs: 200,
  });

  const execPromise = supervisor.execute();
  await new Promise((r) => setTimeout(r, 200));

  await supervisor.cancel('CLEANUP_GROUP');
  const result = await execPromise;

  assert.equal(result.termination.terminatedBySupervisor, true);
  assert.equal(result.termination.terminationVerified, true);
  assert.equal(result.termination.descendantsTerminated, true);
});

test('24. Dummy Worker 11 (Child Exits Before Parent): normal sequential child exit', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('child_exits_before_parent.js')],
  });

  const result = await supervisor.execute();
  assert.equal(result.success, true);
  assert.equal(result.output?.childExitedFirst, true);
  assert.equal(result.termination.terminationVerified, true);
});

test('25. Dummy Worker 12 (Descendant Survives Parent): cleans up orphaned process group', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('descendant_survives_parent.js')],
    terminationGracePeriodMs: 200,
  });

  const execPromise = supervisor.execute();
  await new Promise((r) => setTimeout(r, 200));

  // Cancel to ensure supervisor reaps group
  await supervisor.cancel('REAP_ORPHANS');
  const result = await execPromise;

  assert.equal(result.termination.terminationVerified, true);
  assert.equal(result.termination.descendantsTerminated, true);
});

test('26. Dummy Worker 13 (Detaches From Process Group): limitation detected on detached session', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('detaches_from_pgroup.js')],
  });

  const result = await supervisor.execute();
  assert.equal(result.state, 'RECOVERY_REQUIRED'); // Failed-closed because detached descendant escaped termination verification

  // Verify that supervisor accurately detects escaped descendant and refuses to certify termination
  assert.equal(result.termination.escapedDescendantState, 'ESCAPED');
  assert.equal(result.termination.descendantsTerminated, false);
  assert.equal(result.termination.terminationVerified, false);

  // Extract detached PID from stderr and clean it up safely in test harness
  const match = result.redactedStderr.match(/DETACHED_PID:(\d+)/);
  if (match) {
    const detachedPid = parseInt(match[1], 10);
    try {
      process.kill(detachedPid, 'SIGKILL');
    } catch {}
  }
});

test('27. Dummy Worker 14 (Unexpected Crash Exit 137): caught as WORKER_CRASHED', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('unexpected_exit.js')],
  });

  const result = await supervisor.execute();
  assert.equal(result.success, false);
  assert.equal(result.termination.exitCode, 137);
  assert.equal(result.termination.terminationVerified, true);
});

test('28. Dummy Worker 15 (Excessive Stderr): clamps stderr to maxStderrBufferBytes', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('excessive_stderr.js')],
    maxStderrBufferBytes: 1024 * 4, // 4 KB limit
  });

  const result = await supervisor.execute();
  assert.equal(result.success, true);
  assert.ok(result.redactedStderr.length <= 1024 * 4);
});

test('29. Dummy Worker 16 (Emits Secrets): redacts sensitive tokens and user paths', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('emits_secrets.js')],
  });

  const result = await supervisor.execute();
  assert.equal(result.success, false);

  assert.ok(!result.redactedStderr.includes('sk-antigravity-998877665544332211'));
  assert.ok(!result.redactedStderr.includes('/Users/abhisheksuman/'));
  assert.ok(!result.errorMessage?.includes('supersecretpassword123'));
  assert.ok(result.redactedStderr.includes('[REDACTED_TOKEN]'));
});

// ============================================================================
// 4. RESOURCE COORDINATOR INTEGRATION & RESERVATION SAFETY (Scope D, E)
// ============================================================================

test('30. Coordinator Integration: clean worker run releases reservation and restores IDLE', async () => {
  const { coordinator, db } = createInMemoryCoordinator();

  const result = await ChildProcessSupervisor.executeWithReservation({
    coordinator,
    resourceType: 'SDXL',
    ownerId: 'user:42',
    workerConfig: {
      workerType: 'DUMMY_WORKER',
      executable: process.execPath,
      args: [getWorkerPath('immediate_success.js')],
    },
  });

  assert.equal(result.success, true);
  assert.equal(coordinator.getState(), 'IDLE');

  // Verify reservation in persistence is RELEASED
  const row = db.prepare('SELECT status FROM resource_reservations ORDER BY acquiredAt DESC LIMIT 1').get() as any;
  assert.equal(row.status, 'RELEASED');
});

test('31. Coordinator Integration: failing worker still releases reservation if termination is verified', async () => {
  const { coordinator } = createInMemoryCoordinator();

  const result = await ChildProcessSupervisor.executeWithReservation({
    coordinator,
    resourceType: 'SDXL',
    ownerId: 'user:42',
    workerConfig: {
      workerType: 'DUMMY_WORKER',
      executable: process.execPath,
      args: [getWorkerPath('structured_failure.js')],
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.termination.terminationVerified, true);
  // Because child termination was verified, reservation was released safely
  assert.equal(coordinator.getState(), 'IDLE');
});

test('32. Coordinator Integration: uncertain termination locks coordinator in RECOVERY_REQUIRED', async () => {
  const { coordinator } = createInMemoryCoordinator();

  // Acquire active reservation
  const resv = await coordinator.acquire('SDXL', 'user:42');

  // Mark recovery required manually simulating unverified process state
  coordinator.markRecoveryRequired(resv.id, 'Uncertain child process state');

  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Subsequent acquire must be rejected fail-closed
  await assert.rejects(
    coordinator.acquire('SDXL', 'user:99'),
    (err: any) => {
      assert.equal(err.code, 'RECOVERY_REQUIRED');
      return true;
    }
  );
});

test('33. Restart & Orphan Recovery: reclaims dead orphaned worker cleanly', async () => {
  const { coordinator, persistence } = createInMemoryCoordinator();

  // Create an active reservation for a dead PID
  persistence.createReservation({
    id: 'resv_orphan_dead',
    resourceType: 'SDXL',
    ownerId: 'user:42',
    status: 'ACTIVE',
    pid: 99999999, // Dead PID
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 2000,
    metadata: {
      workerType: 'DUMMY_WORKER',
      executable: 'node',
    },
  });

  const report = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(
    coordinator,
    persistence
  );

  assert.equal(report.reconciledCount, 1);
  assert.equal(report.failedClosedCount, 0);
  assert.equal(report.details[0].status, 'RECLAIMED_DEAD');
});

test('34. Restart & Orphan Recovery: fails closed without signaling if PID was recycled', async () => {
  const { coordinator, persistence } = createInMemoryCoordinator();

  // Create active reservation recording PID = process.pid, but workerType was python3
  persistence.createReservation({
    id: 'resv_orphan_recycled',
    resourceType: 'SDXL',
    ownerId: 'user:42',
    status: 'ACTIVE',
    pid: process.pid, // Active Node PID
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 2000,
    metadata: {
      workerType: 'DUMMY_WORKER',
      executable: 'python3', // Mismatches active Node executable!
    },
  });

  const report = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(
    coordinator,
    persistence
  );

  assert.equal(report.failedClosedCount, 1);
  assert.ok(report.details[0].status.startsWith('FAIL_CLOSED_'));
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
});
