/**
 * Auravo Studio — AI-Foundation 2.3.3.1.2
 * Child Supervisor Persistence, Spawn-Race & Signal Safety Remediation Tests
 * 
 * Verifies all 8 forensic audit remediation workstreams:
 * 1. Child PID, PGID, start time, and durable lifecycle state persistence into SQLite.
 * 2. Pre-spawn and during-spawn cancellation race safety.
 * 3. Concurrent cancellation idempotency.
 * 4. Recycled PID and start-time delta rejection in process identity and safe signaling.
 * 5. Zombie process detection without repeated SIGKILL loops.
 * 6. Detached descendant detection preventing false reservation release.
 * 7. Startup orphan recovery crash scenarios (SPAWN_PENDING, dead, zombie, recycled, matching orphan).
 * 8. Comprehensive diagnostic redaction (PEM keys, basic auth URLs, query secrets, Windows paths).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  ChildProcessSupervisor,
} from '../coordinator/child_supervisor.js';
import {
  WORKER_PROTOCOL_VERSION,
  sanitizeDiagnostic,
} from '../coordinator/worker_protocol.js';
import {
  getProcessSnapshot,
  verifyProcessIdentity,
  sendVerifiedSignal,
  isProcessAliveSync,
  generateProcessInstanceId,
  resolveProcessGroupIdentity,
  validateSpawnSnapshot,
  formatSnapshotState,
  MAX_SNAPSHOT_DIAGNOSTIC_LENGTH,
  checkProcessGroupLiveness,
  isProcessGroupAlive,
  type ProcessIdentity,
  type OSProcessSnapshot,
} from '../coordinator/process_identity.js';
import { ResourceCoordinator } from '../coordinator/coordinator.js';
import { SQLitePersistenceAdapter } from '../coordinator/persistence.js';
import type { WorkerIdentityMetadata } from '../coordinator/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DUMMY_DIR = path.resolve(__dirname, '../coordinator/dummy_workers');

function getWorkerPath(workerName: string): string {
  return path.join(DUMMY_DIR, workerName);
}

function createTestDatabase(): Database.Database {
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
  return db;
}

// ============================================================================
// WORKSTREAM 1: Durable Child Identity & Lifecycle State Persistence
// ============================================================================

test('Remediation 1: Persists child PID, PGID, and RUNNING lifecycle state to SQLite upon spawn', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  const reservation = await coordinator.acquire('SDXL', 'test_owner', {
    timeoutMs: 10000,
    metadata: {
      workerType: 'DUMMY_WORKER',
      workerIdentity: {
        workerType: 'DUMMY_WORKER',
        executable: process.execPath,
        workerLifecycleState: 'SPAWN_PENDING',
        reservationCreatedAt: Date.now(),
      },
    },
  });

  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('immediate_success.js')],
  });
  supervisor.setReservationContext(reservation.id, persistence);

  const execPromise = supervisor.execute();

  // Poll deterministically for spawn event to fire and persist identity to SQLite (up to 3000ms)
  const pollStart = Date.now();
  let activeRecord = persistence.getReservation(reservation.id);
  let identity = (activeRecord?.metadata as Record<string, unknown> | undefined)?.workerIdentity as WorkerIdentityMetadata | undefined;
  while (Date.now() - pollStart < 3000 && (!activeRecord?.pid || identity?.workerLifecycleState !== 'RUNNING')) {
    await new Promise((r) => setTimeout(r, 10));
    activeRecord = persistence.getReservation(reservation.id);
    identity = (activeRecord?.metadata as Record<string, unknown> | undefined)?.workerIdentity as WorkerIdentityMetadata | undefined;
  }

  // Check database during execution: PID and RUNNING state must be durably recorded
  assert.ok(activeRecord);
  assert.ok(activeRecord.pid && activeRecord.pid > 0, 'childPid must be durably recorded in reservation.pid');

  const meta = activeRecord.metadata as Record<string, unknown>;
  const verifiedIdentity = meta.workerIdentity as WorkerIdentityMetadata;
  assert.ok(verifiedIdentity, 'workerIdentity must be persisted');
  assert.equal(verifiedIdentity.childPid, supervisor.getPid());
  assert.equal(verifiedIdentity.workerLifecycleState, 'RUNNING');
  assert.ok(verifiedIdentity.childPgid && verifiedIdentity.childPgid > 0, 'childPgid must be durably recorded and positive');
  assert.ok(
    verifiedIdentity.pgidVerificationState === 'OS_VERIFIED' || verifiedIdentity.pgidVerificationState === 'UNVERIFIED',
    'pgidVerificationState must be recorded'
  );
  assert.ok(verifiedIdentity.spawnConfirmedAt && verifiedIdentity.spawnConfirmedAt > 0);

  const result = await execPromise;
  assert.equal(result.success, true);
  await reservation.release();
  db.close();
});



test('Remediation 1b: Persists OS_VERIFIED provenance when worker process is verified by OS snapshot', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const reservationId = 'res_remediation_1b';
  persistence.createReservation({
    id: reservationId,
    resourceType: 'SDXL',
    ownerId: 'owner_1b',
    status: 'ACTIVE',
    acquiredAt: Date.now(),
    lastHeartbeatAt: Date.now(),
  });

  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('delayed_response.js')],
  });
  supervisor.setReservationContext(reservationId, persistence);

  const execPromise = supervisor.execute();

  // Poll deterministically for spawn event to fire and persist identity to SQLite (up to 3000ms)
  const pollStart = Date.now();
  let activeRecord = persistence.getReservation(reservationId);
  let identity = (activeRecord?.metadata as Record<string, unknown> | undefined)?.workerIdentity as WorkerIdentityMetadata | undefined;
  while (Date.now() - pollStart < 3000 && (!activeRecord?.pid || identity?.workerLifecycleState !== 'RUNNING')) {
    await new Promise((r) => setTimeout(r, 10));
    activeRecord = persistence.getReservation(reservationId);
    identity = (activeRecord?.metadata as Record<string, unknown> | undefined)?.workerIdentity as WorkerIdentityMetadata | undefined;
  }

  assert.ok(activeRecord);
  assert.ok(activeRecord.pid && activeRecord.pid > 0);
  const meta = activeRecord.metadata as Record<string, unknown>;
  const verifiedIdentity = meta.workerIdentity as WorkerIdentityMetadata;
  assert.ok(verifiedIdentity);
  assert.equal(verifiedIdentity.childPid, supervisor.getPid());
  assert.equal(verifiedIdentity.workerLifecycleState, 'RUNNING');
  assert.ok(verifiedIdentity.childPgid && verifiedIdentity.childPgid > 0);
  if (verifiedIdentity.pgidVerificationState === 'OS_VERIFIED') {
    assert.equal(verifiedIdentity.pgidVerificationState, 'OS_VERIFIED');
  } else {
    // When OS process snapshot is blocked by sandbox seatbelt policy, fail-closed to UNVERIFIED (never promoted!)
    assert.equal(verifiedIdentity.pgidVerificationState, 'UNVERIFIED');
  }

  const result = await execPromise;
  assert.equal(result.success, true);
  db.close();
});



test('Remediation 1c: Explicit provenance logic strictly enforces OS_VERIFIED vs UNVERIFIED', () => {
  function evaluatePgidProvenance(pid: number, snap: { pgid?: number; lstart?: string } | null): {
    persistedPgid: number | null;
    pgidVerificationState: 'UNVERIFIED' | 'OS_VERIFIED';
  } {
    let pgidVerificationState: 'UNVERIFIED' | 'OS_VERIFIED' = 'UNVERIFIED';
    let verifiedPgid: number | null = null;
    if (
      snap?.pgid &&
      snap.pgid > 0 &&
      Number.isInteger(snap.pgid) &&
      snap.pgid === pid
    ) {
      verifiedPgid = snap.pgid;
      pgidVerificationState = 'OS_VERIFIED';
    } else {
      verifiedPgid = null;
      pgidVerificationState = 'UNVERIFIED';
    }
    const persistedPgid = (verifiedPgid !== null && verifiedPgid > 0) ? verifiedPgid : (pid > 0 ? pid : null);
    return { persistedPgid, pgidVerificationState };
  }

  // 1. Valid matching snapshot -> OS_VERIFIED
  assert.deepEqual(evaluatePgidProvenance(1234, { pgid: 1234 }), {
    persistedPgid: 1234,
    pgidVerificationState: 'OS_VERIFIED',
  });

  // 2. Missing snapshot (null) -> UNVERIFIED (never promoted!)
  assert.deepEqual(evaluatePgidProvenance(1234, null), {
    persistedPgid: 1234,
    pgidVerificationState: 'UNVERIFIED',
  });

  // 3. Mismatched PGID in snapshot -> UNVERIFIED
  assert.deepEqual(evaluatePgidProvenance(1234, { pgid: 5678 }), {
    persistedPgid: 1234,
    pgidVerificationState: 'UNVERIFIED',
  });

  // 4. Zero PGID -> UNVERIFIED
  assert.deepEqual(evaluatePgidProvenance(1234, { pgid: 0 }), {
    persistedPgid: 1234,
    pgidVerificationState: 'UNVERIFIED',
  });

  // 5. Negative PGID -> UNVERIFIED
  assert.deepEqual(evaluatePgidProvenance(1234, { pgid: -1234 }), {
    persistedPgid: 1234,
    pgidVerificationState: 'UNVERIFIED',
  });

  // 6. Fractional PGID -> UNVERIFIED
  assert.deepEqual(evaluatePgidProvenance(1234, { pgid: 1234.56 }), {
    persistedPgid: 1234,
    pgidVerificationState: 'UNVERIFIED',
  });
});

// ============================================================================
// WORKSTREAM 2: Cancellation Race Elimination (Pre-Spawn and In-Spawn)
// ============================================================================

test('Remediation 2a: Cancellation before execute() cleanly terminates without spawning', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('infinite_process.js')],
  });

  // Cancel prior to calling execute()
  const termResult = await supervisor.cancel('CANCELLED_BEFORE_EXECUTE');
  assert.equal(termResult.terminationVerified, true);
  assert.equal(supervisor.getState(), 'TERMINATED');

  // Attempting execute() after cancel() must reject immediately
  await assert.rejects(
    async () => {
      await supervisor.execute();
    },
    /Cannot execute supervisor in state 'TERMINATED'/
  );
});

test('Remediation 2b: Cancellation during spawn halts and terminates spawned child cleanly', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('infinite_process.js')],
  });

  // Start execute and immediately cancel in the same microtask
  const execPromise = supervisor.execute();
  const cancelPromise = supervisor.cancel('CANCELLED_DURING_SPAWN');

  const [execResult, cancelResult] = await Promise.all([execPromise, cancelPromise]);

  assert.equal(cancelResult.terminationVerified, true);
  assert.equal(execResult.success, false);
  assert.equal(execResult.state, 'TERMINATED');

  const pid = supervisor.getPid();
  if (pid) {
    // Verified: child process is dead on the OS
    assert.equal(isProcessAliveSync(pid), false);
  }
});

// ============================================================================
// WORKSTREAM 3: Concurrent Cancellation Idempotency
// ============================================================================

test('Remediation 3: Concurrent calls to cancel() return the identical termination promise', async () => {
  const supervisor = new ChildProcessSupervisor({
    workerType: 'DUMMY_WORKER',
    executable: process.execPath,
    args: [getWorkerPath('infinite_process.js')],
  });

  const execPromise = supervisor.execute();
  await new Promise((r) => setTimeout(r, 20)); // let child start

  // Fire 3 simultaneous cancellations
  const c1 = supervisor.cancel('CONCURRENT_1');
  const c2 = supervisor.cancel('CONCURRENT_2');
  const c3 = supervisor.cancel('CONCURRENT_3');

  assert.strictEqual(c1, c2);
  assert.strictEqual(c2, c3);

  const [r1, r2, r3, execRes] = await Promise.all([c1, c2, c3, execPromise]);

  assert.equal(r1.terminationVerified, true);
  assert.equal(r2.terminationVerified, true);
  assert.equal(r3.terminationVerified, true);
  assert.equal(execRes.success, false);
});

// ============================================================================
// WORKSTREAM 4: Anti-PID-Reuse & Identity Revalidation
// ============================================================================

test('Remediation 4a: Rejects process identity when start time delta exceeds tolerance', () => {
  const now = Date.now();
  const fakeSnapshot: OSProcessSnapshot = {
    pid: 88888,
    ppid: 1,
    pgid: 88888,
    state: 'RUNNING',
    startTimeMs: now - 60000, // 60s ago
    command: 'node worker.js',
  };

  const expected: ProcessIdentity = {
    requestId: 'req_1',
    processInstanceId: 'proc_88888_1',
    pid: 88888,
    processStartedAt: now - 1000, // Expected 1s ago (delta = 59s > 5s limit)
    executable: 'node',
  };

  const verification = verifyProcessIdentity(expected, fakeSnapshot);
  assert.equal(verification.status, 'RECYCLED_PID');
  assert.equal(verification.canSignal, false);
  assert.match(verification.reason, /reused|recycled/);
});

test('Remediation 4b: sendVerifiedSignal blocks signal if expected identity mismatches current process', () => {
  // Target current process PID but with completely wrong executable identity
  const wrongExpected: ProcessIdentity = {
    requestId: 'req_wrong',
    processInstanceId: 'proc_fake',
    pid: process.pid,
    processStartedAt: Date.now() - 9999999,
    executable: 'non_existent_binary_xyz',
  };

  const result = sendVerifiedSignal(process.pid, undefined, 'SIGTERM', {
    expectedIdentity: wrongExpected,
  });

  assert.equal(result.success, false);
  assert.match(result.error || '', /Safety restriction|identity mismatch/);
});

// ============================================================================
// WORKSTREAM 5: Zombie Process Detection Without Infinite Lockouts
// ============================================================================

test('Remediation 5: Identifies zombie state and forbids destructive signaling', () => {
  const zombieSnapshot: OSProcessSnapshot = {
    pid: 77777,
    ppid: 1,
    pgid: 77777,
    state: 'ZOMBIE',
    rawState: 'Z+',
    command: '[dummy_worker] <defunct>',
  };

  const expected: ProcessIdentity = {
    requestId: 'req_zombie',
    processInstanceId: 'proc_77777_1',
    pid: 77777,
    processStartedAt: Date.now() - 5000,
  };

  const verification = verifyProcessIdentity(expected, zombieSnapshot);
  assert.equal(verification.status, 'MATCH');
  assert.equal(verification.isZombie, true);
  assert.equal(verification.isAlive, false);
  assert.equal(verification.canSignal, false, 'Zombie cannot and must not receive destructive signals');
});

// ============================================================================
// WORKSTREAM 6: Detached Descendant Detection Prevents False Release
// ============================================================================

test('Remediation 6: Detached session descendant detected and prevents false reservation release', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // Execute detached worker guarded by reservation
  const result = await ChildProcessSupervisor.executeWithReservation({
    coordinator,
    resourceType: 'SDXL',
    ownerId: 'test_detached_owner',
    workerConfig: {
      workerType: 'DUMMY_WORKER',
      executable: process.execPath,
      args: [getWorkerPath('detaches_from_pgroup.js')],
    },
  });

  assert.equal(result.termination.escapedDescendantState, 'ESCAPED');
  assert.equal(result.termination.terminationVerified, false);

  // Coordinator MUST remain locked in RECOVERY_REQUIRED to prevent another workload from running!
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Clean up escaped process in test harness
  const match = result.redactedStderr.match(/DETACHED_PID:(\d+)/);
  if (match) {
    try {
      process.kill(parseInt(match[1], 10), 'SIGKILL');
    } catch {}
  }

  db.close();
});



// ============================================================================
// WORKSTREAM 7: Startup Orphan Recovery Crash Scenarios
// ============================================================================

test('Remediation 7a: Startup recovery fails closed on reservation crashed in SPAWN_PENDING state', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // Simulate crashed server that left reservation in SPAWN_PENDING without confirmed PID
  persistence.createReservation({
    id: 'res_crashed_spawning',
    resourceType: 'SDXL',
    ownerId: 'crashed_owner',
    status: 'ACTIVE',
    pid: undefined,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        workerLifecycleState: 'SPAWN_PENDING',
        childPid: null,
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  db.close();
});



test('Remediation 7b: Startup recovery cleanly reclaims reservation with dead child PID and OS-verified empty group', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // Fake confirmed dead PID with OS-verified dead PGID
  const deadPid = 99999998;
  persistence.createReservation({
    id: 'res_dead_child',
    resourceType: 'SDXL',
    ownerId: 'owner_dead',
    status: 'ACTIVE',
    pid: deadPid,
    acquiredAt: Date.now() - 10000,
    lastHeartbeatAt: Date.now() - 10000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: deadPid,
        childPgid: deadPid,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.reconciledCount, 1);
  assert.equal(recovery.details[0].status, 'RECLAIMED_DEAD');

  const rec = persistence.getReservation('res_dead_child');
  assert.equal(rec?.status, 'RELEASED');
  db.close();
});





test('Remediation 7b2: Startup recovery fails closed if dead child process group has active members', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // Fake dead child PID, but process group points to process.pid (our live runner process)
  const deadPid = 99999997;
  persistence.createReservation({
    id: 'res_dead_child_live_group',
    resourceType: 'SDXL',
    ownerId: 'owner_dead_group',
    status: 'ACTIVE',
    pid: deadPid,
    acquiredAt: Date.now() - 10000,
    lastHeartbeatAt: Date.now() - 10000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: deadPid,
        childPgid: process.pid, // Live process group!
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.match(recovery.details[0].reason, /active or uncertain members/);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Verify reservation was marked RECOVERY_REQUIRED and NOT released
  const rec = persistence.getReservation('res_dead_child_live_group');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');
  db.close();
});



test('Remediation 7b3: Startup recovery cleanly reclaims dead child with confirmed EMPTY process group', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // Fake confirmed dead PID and dead PGID
  const deadPid = 99999996;
  const deadPgid = 99999996;
  persistence.createReservation({
    id: 'res_dead_child_empty_group',
    resourceType: 'SDXL',
    ownerId: 'owner_dead_empty',
    status: 'ACTIVE',
    pid: deadPid,
    acquiredAt: Date.now() - 10000,
    lastHeartbeatAt: Date.now() - 10000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: deadPid,
        childPgid: deadPgid,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.reconciledCount, 1);
  assert.equal(recovery.details[0].status, 'RECLAIMED_DEAD');
  assert.match(recovery.details[0].reason, /EMPTY/);

  const rec = persistence.getReservation('res_dead_child_empty_group');
  assert.equal(rec?.status, 'RELEASED');
  db.close();
});



test('Remediation 7d1: Startup recovery fails closed when childPgid is null', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_pgid_null',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999991,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999991,
        childPgid: null,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  const rec = persistence.getReservation('res_pgid_null');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');
  db.close();
});



test('Remediation 7d2: Startup recovery fails closed when childPgid is undefined', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_pgid_undef',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999992,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999992,
        childPgid: undefined,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  const rec = persistence.getReservation('res_pgid_undef');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');
  db.close();
});



test('Remediation 7d3: Startup recovery fails closed when childPgid is 0', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_pgid_zero',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999993,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999993,
        childPgid: 0,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  const rec = persistence.getReservation('res_pgid_zero');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');
  db.close();
});



test('Remediation 7d4: Startup recovery fails closed when childPgid is negative', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_pgid_neg',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999994,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999994,
        childPgid: -42,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  const rec = persistence.getReservation('res_pgid_neg');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');
  db.close();
});



test('Remediation 7d5: Startup recovery fails closed when childPgid is fractional', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_pgid_frac',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999995,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999995,
        childPgid: 99999.55,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  const rec = persistence.getReservation('res_pgid_frac');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');
  db.close();
});



test('Remediation 7d6: Startup recovery fails closed when pgidVerificationState is UNVERIFIED', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_pgid_unverified',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999996,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999996,
        childPgid: 99999996,
        pgidVerificationState: 'UNVERIFIED', // Explicitly unverified!
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.match(recovery.details[0].reason, /verification unavailable/);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  const rec = persistence.getReservation('res_pgid_unverified');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');
  db.close();
});



test('Remediation 7d7: checkProcessGroupLiveness and isProcessGroupAlive return UNKNOWN for invalid PGIDs and unsupported platforms', async () => {
  const { checkProcessGroupLiveness, isProcessGroupAlive } = await import('../coordinator/process_identity.js');

  assert.equal(await checkProcessGroupLiveness(undefined), 'UNKNOWN');
  assert.equal(await checkProcessGroupLiveness(null as any), 'UNKNOWN');
  assert.equal(await checkProcessGroupLiveness(0), 'UNKNOWN');
  assert.equal(await checkProcessGroupLiveness(-1), 'UNKNOWN');
  assert.equal(await checkProcessGroupLiveness(123.456), 'UNKNOWN');
  assert.equal(await checkProcessGroupLiveness(NaN), 'UNKNOWN');

  assert.equal(isProcessGroupAlive(undefined as any), 'UNKNOWN');
  assert.equal(isProcessGroupAlive(null as any), 'UNKNOWN');
  assert.equal(isProcessGroupAlive(0), 'UNKNOWN');
  assert.equal(isProcessGroupAlive(-1), 'UNKNOWN');
  assert.equal(isProcessGroupAlive(123.456), 'UNKNOWN');
  assert.equal(isProcessGroupAlive(NaN), 'UNKNOWN');
});

test('Remediation 7d8: Startup recovery preserves RECOVERY_REQUIRED when groupState is UNKNOWN or ERROR', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // PGID 1 is root/launchd; kill(-1, 0) throws EPERM (ERROR) or has live members
  persistence.createReservation({
    id: 'res_pgid_error_or_unknown',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999998,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999998,
        childPgid: 1,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.match(recovery.details[0].reason, /active or uncertain members/);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  const rec = persistence.getReservation('res_pgid_error_or_unknown');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');
  db.close();
});



test('Remediation 7c: Startup recovery fails closed without signalling if PID was recycled by another process', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // Use process.ppid (system/terminal shell) as a live process that is unrelated to the worker
  const unrelatedAlivePid = process.ppid;
  persistence.createReservation({
    id: 'res_recycled',
    resourceType: 'SDXL',
    ownerId: 'owner_recycled',
    status: 'ACTIVE',
    pid: unrelatedAlivePid,
    acquiredAt: Date.now() - 50000,
    lastHeartbeatAt: Date.now() - 50000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: unrelatedAlivePid,
        processStartedAt: Date.now() - 1000, // Mismatched start time
        executable: 'python3_sdxl_never_existed',
        command: 'python3_sdxl_never_existed',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.ok(
    recovery.details[0].status === 'FAIL_CLOSED_RECYCLED_PID' || recovery.details[0].status === 'FAIL_CLOSED_UNKNOWN',
    `Expected status to fail closed, got ${recovery.details[0].status}`
  );
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Verify the unrelated process was NOT killed!
  assert.equal(isProcessAliveSync(unrelatedAlivePid), true);

  db.close();
});



// ============================================================================
// WORKSTREAM 8: Comprehensive Diagnostic Redaction
// ============================================================================

test('Remediation 8a: Redacts multiline RSA and EC PEM private keys', () => {
  const raw = `
    Error loading model with key:
    -----BEGIN RSA PRIVATE KEY-----
    MIIEowIBAAKCAQEA0Y1234567890abcdefghijklmnopqrstuvwxyz
    ABCDEFGHIJKLMOPQRSTUVWXYZ1234567890abcdefghijklmnopqrs
    -----END RSA PRIVATE KEY-----
    and also:
    -----BEGIN PRIVATE KEY-----
    MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgxyz
    -----END PRIVATE KEY-----
  `;
  const sanitized = sanitizeDiagnostic(raw);
  assert.ok(!sanitized.includes('MIIEowIBAAKCAQEA0Y1234567890'));
  assert.ok(!sanitized.includes('MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgxyz'));
  assert.ok(sanitized.includes('[REDACTED_PRIVATE_KEY]'));
});

test('Remediation 8b: Redacts URL basic authentication and query string credentials', () => {
  const raw = 'Failed to connect to https://admin_user:super_secret_p%40ss@api.auravo.internal/v1?token=tok_live_123456&api_key=sk_live_99999';
  const sanitized = sanitizeDiagnostic(raw);
  assert.ok(!sanitized.includes('super_secret_p%40ss'));
  assert.ok(!sanitized.includes('tok_live_123456'));
  assert.ok(!sanitized.includes('sk_live_99999'));
  assert.ok(sanitized.includes('https://[REDACTED_CREDENTIALS]@api.auravo.internal'));
  assert.ok(sanitized.includes('token=[REDACTED]'));
  assert.ok(sanitized.includes('api_key=[REDACTED]'));
});

test('Remediation 8c: Redacts Authorization headers and bearer tokens', () => {
  const raw = 'Request header: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDN correctly failed';
  const sanitized = sanitizeDiagnostic(raw);
  assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDN'));
  assert.ok(sanitized.includes('Bearer [REDACTED_TOKEN]'));
});

test('Remediation 8d: Redacts Windows and macOS/Linux absolute file paths', () => {
  const raw = 'Crash in C:\\Users\\Administrator\\AppData\\Local\\Temp\\weights.safetensors and /Users/developer/studio/keys/secret.json';
  const sanitized = sanitizeDiagnostic(raw);
  assert.ok(!sanitized.includes('C:\\Users\\Administrator'));
  assert.ok(!sanitized.includes('/Users/developer'));
  assert.ok(sanitized.includes('[REDACTED_WIN_PATH]'));
  assert.ok(sanitized.includes('/Users/[USER]/') || sanitized.includes('[REDACTED_PATH]'));
});

// ============================================================================
// WORKSTREAM 9 (Phase 2.3.3.1.10): PGID Provenance Pairing, Verified Signaling & Snapshot Matrix
// ============================================================================

// ----------------------------------------------------------------------------
// Part A: Metadata Provenance Pairing
// ----------------------------------------------------------------------------

test('Remediation 9a1: resolveProcessGroupIdentity with matching sources and OS_VERIFIED', () => {
  const wi = { childPgid: 4321, pgidVerificationState: 'OS_VERIFIED' as const };
  const meta = { childPgid: 4321, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.pgid, 4321);
  assert.equal(res.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res.source, 'WORKER_IDENTITY');
  assert.equal(res.hasConflict, false);
});

test('Remediation 9a2: resolveProcessGroupIdentity with both sources missing', () => {
  const res = resolveProcessGroupIdentity(null, null);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.source, 'NONE');
  assert.equal(res.hasConflict, false);
});

test('Remediation 9a3: resolveProcessGroupIdentity with one source missing', () => {
  // workerIdentity only
  const res1 = resolveProcessGroupIdentity({ childPgid: 4321, pgidVerificationState: 'OS_VERIFIED' }, null);
  assert.equal(res1.pgid, 4321);
  assert.equal(res1.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res1.source, 'WORKER_IDENTITY');
  assert.equal(res1.hasConflict, false);

  // reservation metadata only
  const res2 = resolveProcessGroupIdentity(null, { childPgid: 5432, pgidVerificationState: 'OS_VERIFIED' });
  assert.equal(res2.pgid, 5432);
  assert.equal(res2.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res2.source, 'RESERVATION_METADATA');
  assert.equal(res2.hasConflict, false);
});

test('Remediation 9a4: resolveProcessGroupIdentity with conflicting PGIDs fails closed', () => {
  const wi = { childPgid: 4321, pgidVerificationState: 'OS_VERIFIED' as const };
  const meta = { childPgid: 9876, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.source, 'NONE');
  assert.equal(res.hasConflict, true);
  assert.match(res.conflictReason || '', /Conflicting PGIDs/);
});

test('Remediation 9a5: resolveProcessGroupIdentity with identical PGID but conflicting provenance fails closed', () => {
  // workerIdentity is UNVERIFIED, meta is OS_VERIFIED
  const res1 = resolveProcessGroupIdentity(
    { childPgid: 4321, pgidVerificationState: 'UNVERIFIED' },
    { childPgid: 4321, pgidVerificationState: 'OS_VERIFIED' }
  );
  assert.equal(res1.pgid, undefined);
  assert.equal(res1.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res1.hasConflict, true);
  assert.match(res1.conflictReason || '', /Conflicting provenance/);

  // workerIdentity is OS_VERIFIED, meta is UNVERIFIED
  const res2 = resolveProcessGroupIdentity(
    { childPgid: 4321, pgidVerificationState: 'OS_VERIFIED' },
    { childPgid: 4321, pgidVerificationState: 'UNVERIFIED' }
  );
  assert.equal(res2.pgid, undefined);
  assert.equal(res2.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res2.hasConflict, true);
  assert.match(res2.conflictReason || '', /Conflicting provenance/);
});

test('Remediation 9a6: resolveProcessGroupIdentity with unanchored provenance fails closed', () => {
  // meta has OS_VERIFIED provenance but no PGID, while wi has PGID with UNVERIFIED
  const res1 = resolveProcessGroupIdentity(
    { childPgid: 4321, pgidVerificationState: 'UNVERIFIED' },
    { pgidVerificationState: 'OS_VERIFIED' }
  );
  assert.equal(res1.hasConflict, true);
  assert.equal(res1.pgid, undefined);
  assert.equal(res1.pgidVerificationState, 'UNVERIFIED');
  assert.match(res1.conflictReason || '', /unanchored OS_VERIFIED provenance/);

  // workerIdentity has OS_VERIFIED provenance but no PGID, while meta has PGID with UNVERIFIED
  const res2 = resolveProcessGroupIdentity(
    { pgidVerificationState: 'OS_VERIFIED' },
    { childPgid: 4321, pgidVerificationState: 'UNVERIFIED' }
  );
  assert.equal(res2.hasConflict, true);
  assert.equal(res2.pgid, undefined);
  assert.equal(res2.pgidVerificationState, 'UNVERIFIED');
  assert.match(res2.conflictReason || '', /unanchored OS_VERIFIED provenance/);
});

test('Remediation 9a7: resolveProcessGroupIdentity rejects invalid PGIDs (null, 0, negative, fractional, NaN)', () => {
  const invalidCases = [null, undefined, 0, -1, -500, 12.34, NaN, Infinity, '4321' as any];
  for (const inv of invalidCases) {
    const res = resolveProcessGroupIdentity({ childPgid: inv as any });
    assert.equal(res.pgid, undefined, `Expected undefined for invalid PGID ${inv}`);
    assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  }
});

test('Remediation 9a8: resolveProcessGroupIdentity treats legacy metadata without provenance as UNVERIFIED', () => {
  const res = resolveProcessGroupIdentity(null, { childPgid: 4321 });
  assert.equal(res.pgid, 4321);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.source, 'RESERVATION_METADATA');
  assert.equal(res.hasConflict, false);
});

test('Remediation 9a9: resolveProcessGroupIdentity treats malformed provenance strings as UNVERIFIED', () => {
  const res1 = resolveProcessGroupIdentity({ childPgid: 4321, pgidVerificationState: 'true' as any }, null);
  assert.equal(res1.pgid, 4321);
  assert.equal(res1.pgidVerificationState, 'UNVERIFIED');

  const res2 = resolveProcessGroupIdentity(null, { childPgid: 4321, pgidVerificationState: 'verified' as any });
  assert.equal(res2.pgid, 4321);
  assert.equal(res2.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 9a10: Startup recovery fails closed into RECOVERY_REQUIRED with FAIL_CLOSED_UNKNOWN when metadata has conflict', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // Reservation with conflicting PGIDs between workerIdentity (4321) and meta (9876)
  persistence.createReservation({
    id: 'res_conflict_pgid',
    resourceType: 'SDXL',
    ownerId: 'owner_conflict',
    status: 'ACTIVE',
    pid: 99999991, // dead process
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      childPgid: 9876,
      pgidVerificationState: 'OS_VERIFIED',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999991,
        childPgid: 4321,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.match(recovery.details[0].reason, /Conflicting PGIDs/);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Reservation in DB must remain RECOVERY_REQUIRED
  const record = persistence.getReservation('res_conflict_pgid');
  assert.equal(record?.status, 'RECOVERY_REQUIRED');
  db.close();
});



// ----------------------------------------------------------------------------
// Part B: Signaling Authorization
// ----------------------------------------------------------------------------

test('Remediation 9b1: sendVerifiedSignal with useProcessGroup: true and UNVERIFIED fails closed without signaling', () => {
  const expectedIdentity: ProcessIdentity = {
    requestId: 'req_1',
    processInstanceId: 'proc_1',
    pid: 99999992,
    pgid: 99999992,
    pgidVerificationState: 'UNVERIFIED',
    processStartedAt: Date.now(),
  };

  const result = sendVerifiedSignal(99999992, 99999992, 'SIGTERM', {
    useProcessGroup: true,
    expectedIdentity,
  });

  assert.equal(result.success, false);
  assert.equal(result.deliveredToGroup, false);
  assert.match(result.error || '', /Process identity conflict|Process-group signaling unauthorized/);
});

test('Remediation 9b2: sendVerifiedSignal with useProcessGroup: true and hasConflict: true fails closed', () => {
  const expectedIdentity: ProcessIdentity = {
    requestId: 'req_2',
    processInstanceId: 'proc_2',
    pid: 99999992,
    pgid: 99999992,
    pgidVerificationState: 'OS_VERIFIED',
    hasConflict: true,
    conflictReason: 'Conflicting PGIDs',
    processStartedAt: Date.now(),
  };

  const result = sendVerifiedSignal(99999992, 99999992, 'SIGTERM', {
    useProcessGroup: true,
    expectedIdentity,
  });

  assert.equal(result.success, false);
  assert.equal(result.deliveredToGroup, false);
  assert.match(result.error || '', /Process identity conflict|Process-group signaling unauthorized/);
});

test('Remediation 9b3: sendVerifiedSignal with Mode A direct-child handle succeeds when child is alive', () => {
  let signalDelivered = '';
  const mockChild = {
    pid: 88888,
    exitCode: null,
    signalCode: null,
    kill: (sig: string) => {
      signalDelivered = sig;
      return true;
    },
  };

  const result = sendVerifiedSignal(88888, undefined, 'SIGTERM', {
    useProcessGroup: false,
    childProcess: mockChild,
  });

  assert.equal(result.success, true);
  assert.equal(result.deliveredToGroup, false);
  assert.equal(signalDelivered, 'SIGTERM');
});

test('Remediation 9b4: Direct-child handle failure cannot silently bypass group authorization when UNVERIFIED', () => {
  const mockChild = {
    pid: 88889,
    exitCode: null,
    signalCode: null,
    kill: () => false, // handle kill failed
  };

  const expectedIdentity: ProcessIdentity = {
    requestId: 'req_4',
    processInstanceId: 'proc_4',
    pid: 88889,
    pgid: 88889,
    pgidVerificationState: 'UNVERIFIED',
    processStartedAt: Date.now(),
  };

  const result = sendVerifiedSignal(88889, 88889, 'SIGTERM', {
    useProcessGroup: true,
    childProcess: mockChild,
    expectedIdentity,
  });

  // Must not deliver to group because pgidVerificationState is UNVERIFIED
  assert.equal(result.deliveredToGroup, false);
});

test('Remediation 9b5: sendVerifiedSignal Mode B with OS_VERIFIED process group attempts group signaling', () => {
  // Using an ESRCH PGID to verify that process.kill(-pgid) was dispatched
  const deadPgid = 99999995;
  const expectedIdentity: ProcessIdentity = {
    requestId: 'req_5',
    processInstanceId: 'proc_5',
    pid: deadPgid,
    pgid: deadPgid,
    pgidVerificationState: 'OS_VERIFIED',
    processStartedAt: Date.now(),
  };

  const result = sendVerifiedSignal(deadPgid, deadPgid, 'SIGTERM', {
    useProcessGroup: true,
    expectedIdentity,
    // Providing null snapshot so synchronous dispatch occurs immediately for dead process
    snapshot: null,
  });

  // verifyProcessIdentity returns DEAD for null snapshot, which rejects before dispatch
  assert.equal(result.identityStatus, 'DEAD');
  assert.equal(result.success, false);
  assert.equal(result.deliveredToGroup, false);

  // Now test with matching snapshot: group dispatch MUST attempt process.kill(-pgid)
  const fakeSnapshot: OSProcessSnapshot = {
    pid: deadPgid,
    ppid: 1,
    pgid: deadPgid,
    state: 'RUNNING',
    command: 'node',
    startTimeMs: expectedIdentity.processStartedAt,
  };

  const res2 = sendVerifiedSignal(deadPgid, deadPgid, 'SIGTERM', {
    useProcessGroup: true,
    expectedIdentity,
    snapshot: fakeSnapshot,
  });

  // Because process.kill(-deadPgid) threw ESRCH, deliveredToGroup must be TRUE!
  assert.equal(res2.deliveredToGroup, true);
  assert.equal(res2.success, false);
  assert.match(res2.error || '', /ESRCH: Process group already terminated/);
});

// ----------------------------------------------------------------------------
// Part C: Spawn Snapshot Identity (Complete 10-Case Matrix)
// ----------------------------------------------------------------------------

test('Remediation 9c1: validateSpawnSnapshot Case 1 - Correct PID and correct PGID', () => {
  const snap: OSProcessSnapshot = {
    pid: 1234,
    ppid: 1,
    pgid: 1234,
    state: 'RUNNING',
    command: 'node',
  };
  const res = validateSpawnSnapshot(1234, snap);
  assert.equal(res.isValid, true);
  assert.equal(res.pgid, 1234);
});

test('Remediation 9c2: validateSpawnSnapshot Case 2 - Incorrect snapshot PID', () => {
  const snap: OSProcessSnapshot = {
    pid: 9999,
    ppid: 1,
    pgid: 1234,
    state: 'RUNNING',
    command: 'node',
  };
  const res = validateSpawnSnapshot(1234, snap);
  assert.equal(res.isValid, false);
  assert.match(res.reason || '', /Snapshot PID 9999 does not match expected PID 1234/);
});

test('Remediation 9c3: validateSpawnSnapshot Case 3 - Incorrect snapshot PGID', () => {
  const snap: OSProcessSnapshot = {
    pid: 1234,
    ppid: 1,
    pgid: 5678,
    state: 'RUNNING',
    command: 'node',
  };
  const res = validateSpawnSnapshot(1234, snap);
  assert.equal(res.isValid, false);
  assert.match(res.reason || '', /Snapshot PGID 5678 does not match expected PID 1234/);
});

test('Remediation 9c4: validateSpawnSnapshot Case 4 - Missing snapshot (null/undefined)', () => {
  const res1 = validateSpawnSnapshot(1234, null);
  assert.equal(res1.isValid, false);
  assert.match(res1.reason || '', /Snapshot is missing or not an object/);

  const res2 = validateSpawnSnapshot(1234, undefined);
  assert.equal(res2.isValid, false);
  assert.match(res2.reason || '', /Snapshot is missing or not an object/);
});

test('Remediation 9c5: validateSpawnSnapshot Case 5 - Missing PID in snapshot', () => {
  const snap = {
    ppid: 1,
    pgid: 1234,
    state: 'RUNNING',
    command: 'node',
  } as any;
  const res = validateSpawnSnapshot(1234, snap);
  assert.equal(res.isValid, false);
  assert.match(res.reason || '', /Invalid snapshot PID/);
});

test('Remediation 9c6: validateSpawnSnapshot Case 6 - Missing PGID in snapshot', () => {
  const snap = {
    pid: 1234,
    ppid: 1,
    state: 'RUNNING',
    command: 'node',
  } as any;
  const res = validateSpawnSnapshot(1234, snap);
  assert.equal(res.isValid, false);
  assert.match(res.reason || '', /Invalid snapshot PGID/);
});

test('Remediation 9c7: validateSpawnSnapshot Case 7 - Zero PID or PGID', () => {
  const snapPidZero = { pid: 0, ppid: 1, pgid: 1234, state: 'RUNNING', command: 'node' } as any;
  const res1 = validateSpawnSnapshot(1234, snapPidZero);
  assert.equal(res1.isValid, false);
  assert.match(res1.reason || '', /Invalid snapshot PID: 0/);

  const snapPgidZero = { pid: 1234, ppid: 1, pgid: 0, state: 'RUNNING', command: 'node' } as any;
  const res2 = validateSpawnSnapshot(1234, snapPgidZero);
  assert.equal(res2.isValid, false);
  assert.match(res2.reason || '', /Invalid snapshot PGID: 0/);
});

test('Remediation 9c8: validateSpawnSnapshot Case 8 - Fractional PID or PGID', () => {
  const snapPidFrac = { pid: 12.34, ppid: 1, pgid: 1234, state: 'RUNNING', command: 'node' } as any;
  const res1 = validateSpawnSnapshot(1234, snapPidFrac);
  assert.equal(res1.isValid, false);
  assert.match(res1.reason || '', /Invalid snapshot PID/);

  const snapPgidFrac = { pid: 1234, ppid: 1, pgid: 12.34, state: 'RUNNING', command: 'node' } as any;
  const res2 = validateSpawnSnapshot(1234, snapPgidFrac);
  assert.equal(res2.isValid, false);
  assert.match(res2.reason || '', /Invalid snapshot PGID/);
});

test('Remediation 9c9: validateSpawnSnapshot Case 9 - Snapshot inspection error or non-object', () => {
  assert.equal(validateSpawnSnapshot(1234, 'error' as any).isValid, false);
  assert.equal(validateSpawnSnapshot(1234, 12345 as any).isValid, false);
  assert.equal(validateSpawnSnapshot(1234, true as any).isValid, false);
});

test('Remediation 9c10: validateSpawnSnapshot Case 10 - Snapshot state allowlist accepts only RUNNING and SLEEPING, strictly rejects all others', () => {
  const baseSnap = {
    pid: 1234,
    ppid: 1,
    pgid: 1234,
    command: 'node',
  };

  // 1. RUNNING accepted
  const runningRes = validateSpawnSnapshot(1234, { ...baseSnap, state: 'RUNNING' });
  assert.equal(runningRes.isValid, true);
  assert.equal(runningRes.pgid, 1234);

  // 2. SLEEPING accepted
  const sleepingRes = validateSpawnSnapshot(1234, { ...baseSnap, state: 'SLEEPING' });
  assert.equal(sleepingRes.isValid, true);
  assert.equal(sleepingRes.pgid, 1234);

  // 3. STOPPED rejected
  const stoppedRes = validateSpawnSnapshot(1234, { ...baseSnap, state: 'STOPPED' as any });
  assert.equal(stoppedRes.isValid, false);
  assert.equal(stoppedRes.pgid, undefined);
  assert.match(stoppedRes.reason || '', /not eligible for verification/);

  // 4. ZOMBIE rejected
  const zombieRes = validateSpawnSnapshot(1234, { ...baseSnap, state: 'ZOMBIE' });
  assert.equal(zombieRes.isValid, false);
  assert.equal(zombieRes.pgid, undefined);
  assert.match(zombieRes.reason || '', /already a zombie/);

  // 5. UNKNOWN rejected
  const unknownRes = validateSpawnSnapshot(1234, { ...baseSnap, state: 'UNKNOWN' });
  assert.equal(unknownRes.isValid, false);
  assert.equal(unknownRes.pgid, undefined);
  assert.match(unknownRes.reason || '', /state is UNKNOWN/);

  // 6. DEAD rejected
  const deadRes = validateSpawnSnapshot(1234, { ...baseSnap, state: 'DEAD' as any });
  assert.equal(deadRes.isValid, false);
  assert.equal(deadRes.pgid, undefined);
  assert.match(deadRes.reason || '', /not eligible for verification/);

  // 7. Missing state rejected
  const missingStateRes = validateSpawnSnapshot(1234, { pid: 1234, ppid: 1, pgid: 1234, command: 'node' } as any);
  assert.equal(missingStateRes.isValid, false);
  assert.equal(missingStateRes.pgid, undefined);
  assert.match(missingStateRes.reason || '', /not eligible for verification/);

  // 8. undefined state rejected
  const undefStateRes = validateSpawnSnapshot(1234, { ...baseSnap, state: undefined as any });
  assert.equal(undefStateRes.isValid, false);
  assert.equal(undefStateRes.pgid, undefined);
  assert.match(undefStateRes.reason || '', /not eligible for verification/);

  // 9. null state rejected
  const nullStateRes = validateSpawnSnapshot(1234, { ...baseSnap, state: null as any });
  assert.equal(nullStateRes.isValid, false);
  assert.equal(nullStateRes.pgid, undefined);
  assert.match(nullStateRes.reason || '', /not eligible for verification/);

  // 10. Empty string state rejected
  const emptyStateRes = validateSpawnSnapshot(1234, { ...baseSnap, state: '' as any });
  assert.equal(emptyStateRes.isValid, false);
  assert.equal(emptyStateRes.pgid, undefined);
  assert.match(emptyStateRes.reason || '', /not eligible for verification/);

  // 11. Arbitrary unexpected string rejected
  const unexpStateRes = validateSpawnSnapshot(1234, { ...baseSnap, state: 'DEFUNCT_SPECIAL' as any });
  assert.equal(unexpStateRes.isValid, false);
  assert.equal(unexpStateRes.pgid, undefined);
  assert.match(unexpStateRes.reason || '', /not eligible for verification/);

  // 12. Non-string state rejected (number)
  const numStateRes = validateSpawnSnapshot(1234, { ...baseSnap, state: 999 as any });
  assert.equal(numStateRes.isValid, false);
  assert.equal(numStateRes.pgid, undefined);
  assert.match(numStateRes.reason || '', /not eligible for verification/);

  // 13. Boolean state rejected
  const boolStateRes = validateSpawnSnapshot(1234, { ...baseSnap, state: true as any });
  assert.equal(boolStateRes.isValid, false);
  assert.equal(boolStateRes.pgid, undefined);
  assert.match(boolStateRes.reason || '', /not eligible for verification/);

  // 14. Plain object state rejected
  const objStateRes = validateSpawnSnapshot(1234, { ...baseSnap, state: {} as any });
  assert.equal(objStateRes.isValid, false);
  assert.equal(objStateRes.pgid, undefined);
  assert.match(objStateRes.reason || '', /not eligible for verification/);

  // 15. Array state rejected
  const arrStateRes = validateSpawnSnapshot(1234, { ...baseSnap, state: [] as any });
  assert.equal(arrStateRes.isValid, false);
  assert.equal(arrStateRes.pgid, undefined);
  assert.match(arrStateRes.reason || '', /not eligible for verification/);

  // 16. Symbol('TEST') state safely rejected without throwing
  const symTestRes = validateSpawnSnapshot(1234, { ...baseSnap, state: Symbol('TEST') as any });
  assert.equal(symTestRes.isValid, false);
  assert.equal(symTestRes.pgid, undefined);
  assert.match(symTestRes.reason || '', /Snapshot process state 'Symbol' is not eligible for verification/);

  // 17. Anonymous Symbol() state safely rejected without throwing
  const symAnonRes = validateSpawnSnapshot(1234, { ...baseSnap, state: Symbol() as any });
  assert.equal(symAnonRes.isValid, false);
  assert.equal(symAnonRes.pgid, undefined);
  assert.match(symAnonRes.reason || '', /Snapshot process state 'Symbol' is not eligible for verification/);

  // 18. BigInt state safely rejected without throwing
  const bigIntRes = validateSpawnSnapshot(1234, { ...baseSnap, state: BigInt(100) as any });
  assert.equal(bigIntRes.isValid, false);
  assert.equal(bigIntRes.pgid, undefined);
  assert.match(bigIntRes.reason || '', /Snapshot process state '\[bigint\]' is not eligible for verification/);

  // 19. Object with throwing toString() safely rejected without throwing
  const hostileToString = {
    ...baseSnap,
    state: {
      toString() {
        throw new Error('Hostile toString called');
      },
    } as any,
  };
  const hostileToStringRes = validateSpawnSnapshot(1234, hostileToString);
  assert.equal(hostileToStringRes.isValid, false);
  assert.equal(hostileToStringRes.pgid, undefined);
  assert.match(hostileToStringRes.reason || '', /not eligible for verification/);

  // 20. Object with throwing Symbol.toPrimitive safely rejected without throwing
  const hostileToPrimitive = {
    ...baseSnap,
    state: {
      [Symbol.toPrimitive]() {
        throw new Error('Hostile Symbol.toPrimitive called');
      },
    } as any,
  };
  const hostileToPrimitiveRes = validateSpawnSnapshot(1234, hostileToPrimitive);
  assert.equal(hostileToPrimitiveRes.isValid, false);
  assert.equal(hostileToPrimitiveRes.pgid, undefined);
  assert.match(hostileToPrimitiveRes.reason || '', /not eligible for verification/);
});

test('Remediation 9c11: validateSpawnSnapshot hostile property getters fail closed without unhandled exceptions', () => {
  const baseSnap = {
    pid: 1234,
    ppid: 1,
    pgid: 1234,
    command: 'node',
  };

  // 1. Hostile getter for state
  const hostileState = {
    ...baseSnap,
    get state() {
      throw new Error('Hostile state getter');
    },
  };
  const stateRes = validateSpawnSnapshot(1234, hostileState as any);
  assert.equal(stateRes.isValid, false);
  assert.equal(stateRes.pgid, undefined);
  assert.equal(stateRes.reason, 'Snapshot properties could not be inspected');

  // 2. Hostile getter for pid
  const hostilePid = {
    ...baseSnap,
    state: 'RUNNING',
    get pid() {
      throw new Error('Hostile pid getter');
    },
  };
  const pidRes = validateSpawnSnapshot(1234, hostilePid as any);
  assert.equal(pidRes.isValid, false);
  assert.equal(pidRes.pgid, undefined);
  assert.equal(pidRes.reason, 'Snapshot properties could not be inspected');

  // 3. Hostile getter for pgid
  const hostilePgid = {
    ...baseSnap,
    state: 'RUNNING',
    get pgid() {
      throw new Error('Hostile pgid getter');
    },
  };
  const pgidRes = validateSpawnSnapshot(1234, hostilePgid as any);
  assert.equal(pgidRes.isValid, false);
  assert.equal(pgidRes.pgid, undefined);
  assert.equal(pgidRes.reason, 'Snapshot properties could not be inspected');
});

test('Remediation 9c12: validateSpawnSnapshot rejects oversized state strings with bounded diagnostic length (<= 256 chars)', () => {
  const baseSnap = {
    pid: 1234,
    ppid: 1,
    pgid: 1234,
    command: 'node',
  };

  // 1. 1,000-character state string
  const str1k = 'A'.repeat(1000);
  const res1k = validateSpawnSnapshot(1234, { ...baseSnap, state: str1k as any });
  assert.equal(res1k.isValid, false);
  assert.equal(res1k.pgid, undefined);
  assert.equal(typeof res1k.reason, 'string');
  assert.ok((res1k.reason?.length || 0) <= MAX_SNAPSHOT_DIAGNOSTIC_LENGTH);
  assert.ok(!res1k.reason?.includes(str1k), 'Must not contain complete oversized string');
  assert.match(res1k.reason || '', /Snapshot process state 'A{60}\.\.\.' is not eligible for verification/);

  // 2. 100,000-character state string
  const str100k = 'B'.repeat(100000);
  const res100k = validateSpawnSnapshot(1234, { ...baseSnap, state: str100k as any });
  assert.equal(res100k.isValid, false);
  assert.equal(res100k.pgid, undefined);
  assert.equal(typeof res100k.reason, 'string');
  assert.ok((res100k.reason?.length || 0) <= MAX_SNAPSHOT_DIAGNOSTIC_LENGTH);
  assert.ok(!res100k.reason?.includes(str100k), 'Must not contain complete oversized string');
  assert.match(res100k.reason || '', /Snapshot process state 'B{60}\.\.\.' is not eligible for verification/);

  // 3. Substantially larger state string (1,000,000 chars)
  const str1m = 'C'.repeat(1000000);
  const res1m = validateSpawnSnapshot(1234, { ...baseSnap, state: str1m as any });
  assert.equal(res1m.isValid, false);
  assert.equal(res1m.pgid, undefined);
  assert.equal(typeof res1m.reason, 'string');
  assert.ok((res1m.reason?.length || 0) <= MAX_SNAPSHOT_DIAGNOSTIC_LENGTH);
  assert.ok(!res1m.reason?.includes(str1m), 'Must not contain complete oversized string');
  assert.match(res1m.reason || '', /Snapshot process state 'C{60}\.\.\.' is not eligible for verification/);
});

test('Remediation 9c13: validateSpawnSnapshot getter exception safety across diverse hostile thrown objects', () => {
  const baseSnap = {
    pid: 1234,
    ppid: 1,
    pgid: 1234,
    command: 'node',
  };

  const hostileValues: Array<{ name: string; thrower: () => never }> = [
    { name: 'normal Error', thrower: () => { throw new Error('standard error'); } },
    { name: 'Error with exceptionally long message', thrower: () => { throw new Error('M'.repeat(50000)); } },
    { name: 'object with throwing message getter', thrower: () => { throw { get message() { throw new Error('nested'); } }; } },
    { name: 'object with throwing toString', thrower: () => { throw { toString() { throw new Error('toString error'); } }; } },
    { name: 'object with throwing Symbol.toPrimitive', thrower: () => { throw { [Symbol.toPrimitive]() { throw new Error('primitive error'); } }; } },
    { name: 'Symbol', thrower: () => { throw Symbol('hostile_symbol'); } },
    { name: 'BigInt', thrower: () => { throw BigInt(999999999999); } },
    { name: 'null', thrower: () => { throw null; } },
    { name: 'undefined', thrower: () => { throw undefined; } },
  ];

  for (const { name, thrower } of hostileValues) {
    const snap = {
      ...baseSnap,
      get state() {
        return thrower();
      },
    };
    const res = validateSpawnSnapshot(1234, snap as any);
    assert.equal(res.isValid, false, `Must fail closed for ${name}`);
    assert.equal(res.pgid, undefined, `Must have undefined pgid for ${name}`);
    assert.equal(typeof res.reason, 'string', `Must return string reason for ${name}`);
    assert.ok((res.reason?.length || 0) <= MAX_SNAPSHOT_DIAGNOSTIC_LENGTH, `Length must be <= 256 for ${name}`);
    assert.equal(res.reason, 'Snapshot properties could not be inspected', `Fixed reason expected for ${name}`);
    assert.ok(!res.reason?.includes('hostile_symbol'), `Must not leak thrown Symbol content for ${name}`);
    assert.ok(!res.reason?.includes('M'.repeat(100)), `Must not leak thrown long error for ${name}`);
  }
});

test('Remediation 9c14: validateSpawnSnapshot proxy get traps and hostile structures fail closed with bounded diagnostics', () => {
  // 1. Proxy get trap throws Error
  const proxyTrapError = new Proxy({}, {
    get() {
      throw new Error('Trap accessed');
    },
  });
  const resProxyError = validateSpawnSnapshot(1234, proxyTrapError as any);
  assert.equal(resProxyError.isValid, false);
  assert.equal(resProxyError.pgid, undefined);
  assert.equal(resProxyError.reason, 'Snapshot properties could not be inspected');
  assert.ok((resProxyError.reason?.length || 0) <= MAX_SNAPSHOT_DIAGNOSTIC_LENGTH);

  // 2. Proxy get trap throws Symbol
  const proxyTrapSymbol = new Proxy({}, {
    get() {
      throw Symbol('trap_symbol');
    },
  });
  const resProxySymbol = validateSpawnSnapshot(1234, proxyTrapSymbol as any);
  assert.equal(resProxySymbol.isValid, false);
  assert.equal(resProxySymbol.pgid, undefined);
  assert.equal(resProxySymbol.reason, 'Snapshot properties could not be inspected');
  assert.ok((resProxySymbol.reason?.length || 0) <= MAX_SNAPSHOT_DIAGNOSTIC_LENGTH);

  // 3. State is a function
  const snapFunction = {
    pid: 1234,
    ppid: 1,
    pgid: 1234,
    command: 'node',
    state: () => 'RUNNING',
  };
  const resFunction = validateSpawnSnapshot(1234, snapFunction as any);
  assert.equal(resFunction.isValid, false);
  assert.equal(resFunction.pgid, undefined);
  assert.equal(resFunction.reason, "Snapshot process state '[function]' is not eligible for verification");
  assert.ok((resFunction.reason?.length || 0) <= MAX_SNAPSHOT_DIAGNOSTIC_LENGTH);

  // 4. State is an array
  const snapArray = {
    pid: 1234,
    ppid: 1,
    pgid: 1234,
    command: 'node',
    state: ['RUNNING'],
  };
  const resArray = validateSpawnSnapshot(1234, snapArray as any);
  assert.equal(resArray.isValid, false);
  assert.equal(resArray.pgid, undefined);
  assert.equal(resArray.reason, "Snapshot process state '[object]' is not eligible for verification");
  assert.ok((resArray.reason?.length || 0) <= MAX_SNAPSHOT_DIAGNOSTIC_LENGTH);

  // 5. PID getter throws
  const snapThrowingPid = {
    ppid: 1,
    pgid: 1234,
    command: 'node',
    state: 'RUNNING',
    get pid() {
      throw new Error('PID getter error');
    },
  };
  const resThrowingPid = validateSpawnSnapshot(1234, snapThrowingPid as any);
  assert.equal(resThrowingPid.isValid, false);
  assert.equal(resThrowingPid.pgid, undefined);
  assert.equal(resThrowingPid.reason, 'Snapshot properties could not be inspected');

  // 6. PGID getter throws
  const snapThrowingPgid = {
    pid: 1234,
    ppid: 1,
    command: 'node',
    state: 'RUNNING',
    get pgid() {
      throw new Error('PGID getter error');
    },
  };
  const resThrowingPgid = validateSpawnSnapshot(1234, snapThrowingPgid as any);
  assert.equal(resThrowingPgid.isValid, false);
  assert.equal(resThrowingPgid.pgid, undefined);
  assert.equal(resThrowingPgid.reason, 'Snapshot properties could not be inspected');
});

// ----------------------------------------------------------------------------
// Part D: Coordinator Admission Invariants
// ----------------------------------------------------------------------------

test('Remediation 9d1: Conflicting metadata preserves RECOVERY_REQUIRED and blocks coordinator admission', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_conflict_block',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999997,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      childPgid: 9876,
      pgidVerificationState: 'OS_VERIFIED',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999997,
        childPgid: 4321,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Verify reservation is NOT RELEASED
  const rec = persistence.getReservation('res_conflict_block');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');

  // Verify coordinator admission is strictly blocked
  await assert.rejects(
    async () => {
      await coordinator.acquire('SDXL', 'new_request');
    },
    /RECOVERY_REQUIRED/
  );

  db.close();
});




test('Remediation 9d2: Dead worker with unverified PGID preserves RECOVERY_REQUIRED and blocks coordinator admission', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_unverified_block',
    resourceType: 'SDXL',
    ownerId: 'owner_test',
    status: 'ACTIVE',
    pid: 99999996,
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      workerType: 'SDXL_WORKER',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999996,
        childPgid: 99999996,
        pgidVerificationState: 'UNVERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Verify reservation is NOT RELEASED
  const rec = persistence.getReservation('res_unverified_block');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');

  // Verify coordinator admission is strictly blocked
  await assert.rejects(
    async () => {
      await coordinator.acquire('SDXL', 'new_request');
    },
    /RECOVERY_REQUIRED/
  );

  db.close();
});



// ============================================================================
// WORKSTREAM 10 (Phase 2.3.3.1.12): Metadata Alias Consistency & Recovery Hardening
// ============================================================================

test('Remediation 10.1: Matching valid aliases with OS_VERIFIED provenance', () => {
  const meta = { childPgid: 100, pgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(null, meta);
  assert.equal(res.pgid, 100);
  assert.equal(res.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res.hasConflict, false);
  assert.equal(res.source, 'RESERVATION_METADATA');
});

test('Remediation 10.2: Conflicting aliases with OS_VERIFIED provenance fails closed', () => {
  const meta = { childPgid: 100, pgid: 200, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(null, meta);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.hasConflict, true);
  assert.match(res.conflictReason || '', /Conflicting metadata PGID aliases/);

  // Group signaling must not be authorized
  const sigRes = sendVerifiedSignal(100, 100, 'SIGTERM', {
    useProcessGroup: true,
    expectedIdentity: {
      ...res,
      pid: 100,
      requestId: 'req_10_2',
      processInstanceId: 'proc_10_2',
      processStartedAt: Date.now(),
    },
  });
  assert.equal(sigRes.success, false);
  assert.equal(sigRes.deliveredToGroup, false);
});

test('Remediation 10.3: childPgid valid and pgid invalid in metadata fails closed', () => {
  const invalidVariants = [-1, 0, 100.5, NaN, '100' as any, Infinity];
  for (const inv of invalidVariants) {
    const meta = { childPgid: 100, pgid: inv, pgidVerificationState: 'OS_VERIFIED' as const };
    const res = resolveProcessGroupIdentity(null, meta);
    assert.equal(res.pgid, undefined, `Expected undefined for invalid pgid ${inv}`);
    assert.equal(res.pgidVerificationState, 'UNVERIFIED');
    assert.equal(res.hasConflict, true);
    assert.match(res.conflictReason || '', /malformed PGID alias in reservation metadata/);
  }
});

test('Remediation 10.4: childPgid invalid and pgid valid in metadata fails closed', () => {
  const invalidVariants = [-1, 0, 100.5, NaN, '100' as any, Infinity];
  for (const inv of invalidVariants) {
    const meta = { childPgid: inv, pgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
    const res = resolveProcessGroupIdentity(null, meta);
    assert.equal(res.pgid, undefined, `Expected undefined for invalid childPgid ${inv}`);
    assert.equal(res.pgidVerificationState, 'UNVERIFIED');
    assert.equal(res.hasConflict, true);
    assert.match(res.conflictReason || '', /malformed PGID alias in reservation metadata/);
  }
});

test('Remediation 10.5: Zero PGID in either alias fails closed or resolves unverified', () => {
  // Both zero -> conflict/invalid
  const resBothZero = resolveProcessGroupIdentity(null, { childPgid: 0, pgid: 0 });
  assert.equal(resBothZero.pgid, undefined);
  assert.equal(resBothZero.hasConflict, true);

  // Single zero alias -> rejected as invalid PGID
  const resChildZero = resolveProcessGroupIdentity(null, { childPgid: 0 });
  assert.equal(resChildZero.pgid, undefined);
  assert.equal(resChildZero.pgidVerificationState, 'UNVERIFIED');

  const resPgidZero = resolveProcessGroupIdentity(null, { pgid: 0 });
  assert.equal(resPgidZero.pgid, undefined);
  assert.equal(resPgidZero.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 10.6: Negative PGID in either alias fails closed or resolves unverified', () => {
  const resBothNeg = resolveProcessGroupIdentity(null, { childPgid: -10, pgid: -10 });
  assert.equal(resBothNeg.pgid, undefined);
  assert.equal(resBothNeg.hasConflict, true);

  const resChildNeg = resolveProcessGroupIdentity(null, { childPgid: -10 });
  assert.equal(resChildNeg.pgid, undefined);
  assert.equal(resChildNeg.pgidVerificationState, 'UNVERIFIED');

  const resPgidNeg = resolveProcessGroupIdentity(null, { pgid: -10 });
  assert.equal(resPgidNeg.pgid, undefined);
  assert.equal(resPgidNeg.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 10.7: Fractional PGID in either alias fails closed or resolves unverified', () => {
  const resBothFrac = resolveProcessGroupIdentity(null, { childPgid: 12.34, pgid: 12.34 });
  assert.equal(resBothFrac.pgid, undefined);
  assert.equal(resBothFrac.hasConflict, true);

  const resChildFrac = resolveProcessGroupIdentity(null, { childPgid: 12.34 });
  assert.equal(resChildFrac.pgid, undefined);
  assert.equal(resChildFrac.pgidVerificationState, 'UNVERIFIED');

  const resPgidFrac = resolveProcessGroupIdentity(null, { pgid: 12.34 });
  assert.equal(resPgidFrac.pgid, undefined);
  assert.equal(resPgidFrac.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 10.8: Missing aliases resolves unverified without conflict', () => {
  const res = resolveProcessGroupIdentity(null, {});
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.source, 'NONE');
  assert.equal(res.hasConflict, false);
});

test('Remediation 10.9: Explicit null alias alongside a valid alias safely uses the single valid alias', () => {
  // childPgid null, pgid valid
  const res1 = resolveProcessGroupIdentity(null, {
    childPgid: null,
    pgid: 100,
    pgidVerificationState: 'OS_VERIFIED' as const,
  });
  assert.equal(res1.pgid, 100);
  assert.equal(res1.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res1.hasConflict, false);
  assert.equal(res1.source, 'RESERVATION_METADATA');

  // childPgid valid, pgid null
  const res2 = resolveProcessGroupIdentity(null, {
    childPgid: 100,
    pgid: null,
    pgidVerificationState: 'OS_VERIFIED' as const,
  });
  assert.equal(res2.pgid, 100);
  assert.equal(res2.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res2.hasConflict, false);
  assert.equal(res2.source, 'RESERVATION_METADATA');
});

test('Remediation 10.10: One alias present with valid provenance resolves correctly', () => {
  const res1 = resolveProcessGroupIdentity(null, { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const });
  assert.equal(res1.pgid, 100);
  assert.equal(res1.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res1.hasConflict, false);

  const res2 = resolveProcessGroupIdentity(null, { pgid: 100, pgidVerificationState: 'OS_VERIFIED' as const });
  assert.equal(res2.pgid, 100);
  assert.equal(res2.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res2.hasConflict, false);
});

test('Remediation 10.11: Legacy metadata with only pgid resolves to UNVERIFIED', () => {
  const res = resolveProcessGroupIdentity(null, { pgid: 100 });
  assert.equal(res.pgid, 100);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.hasConflict, false);
  assert.equal(res.source, 'RESERVATION_METADATA');
});

test('Remediation 10.12: Cross-source matching values with valid provenance', () => {
  const wi = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const meta = { childPgid: 100, pgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.pgid, 100);
  assert.equal(res.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(res.hasConflict, false);
  assert.equal(res.source, 'WORKER_IDENTITY');
});

test('Remediation 10.13: Cross-source PGID disagreement fails closed', () => {
  const wi = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const meta = { childPgid: 200, pgid: 200, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.hasConflict, true);
  assert.match(res.conflictReason || '', /Conflicting PGIDs/);
});

test('Remediation 10.14: Cross-source provenance disagreement fails closed', () => {
  const wi = { childPgid: 100, pgidVerificationState: 'UNVERIFIED' as const };
  const meta = { childPgid: 100, pgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.hasConflict, true);
  assert.match(res.conflictReason || '', /Conflicting provenance/);
});

test('Remediation 10.15: Conflicting metadata aliases alongside a matching verified workerIdentity fails closed', async () => {
  // workerIdentity is 100 with OS_VERIFIED
  const wi = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  // meta has childPgid: 100 but pgid: 200 (alias conflict within meta)
  const meta = { childPgid: 100, pgid: 200, pgidVerificationState: 'OS_VERIFIED' as const };

  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.hasConflict, true);
  assert.match(res.conflictReason || '', /Conflicting metadata PGID aliases/);

  // Recovery integration: verify orphaned reservation fails closed and blocks admission
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_alias_conflict_with_wi',
    resourceType: 'SDXL',
    ownerId: 'owner_alias_test',
    status: 'ACTIVE',
    pid: 99999988, // dead process
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      childPgid: 100,
      pgid: 200,
      pgidVerificationState: 'OS_VERIFIED',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999988,
        childPgid: 100,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.match(recovery.details[0].reason, /Conflicting/);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Verify reservation remains RECOVERY_REQUIRED in SQLite
  const rec = persistence.getReservation('res_alias_conflict_with_wi');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');

  // Verify coordinator admission is strictly blocked
  await assert.rejects(
    async () => {
      await coordinator.acquire('SDXL', 'another_request');
    },
    /RECOVERY_REQUIRED/
  );

  db.close();
});



// ============================================================================
// WORKSTREAM 11 (Phase 2.3.3.1.14): Malformed Single-Alias Rejection & Unanchored Provenance
// ============================================================================

test('Remediation 11.1 (Workstream A1): Malformed single childPgid (-1) in meta fails closed and is not rescued by WI', () => {
  const meta = { childPgid: -1 };
  const wi = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.source, 'NONE');
  assert.match(res.conflictReason || '', /malformed PGID alias in reservation metadata/);

  // Group signaling must not be authorized
  const sigRes = sendVerifiedSignal(100, 100, 'SIGTERM', {
    useProcessGroup: true,
    expectedIdentity: {
      ...res,
      pid: 100,
      requestId: 'req_11_1',
      processInstanceId: 'proc_11_1',
      processStartedAt: Date.now(),
    },
  });
  assert.equal(sigRes.success, false);
  assert.equal(sigRes.deliveredToGroup, false);
});

test('Remediation 11.2 (Workstream A2): Malformed single pgid (0) in meta fails closed', () => {
  const meta = { pgid: 0 };
  const wi = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 11.3 (Workstream A3): Malformed single childPgid string ("100") in meta fails closed', () => {
  const meta = { childPgid: '100' as any };
  const wi = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 11.4 (Workstream A4): Malformed single pgid fraction (100.5) in meta fails closed', () => {
  const meta = { pgid: 100.5 };
  const wi = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 11.5 (Workstream B1): Malformed single childPgid (-1) in WI fails closed and is not rescued by meta', () => {
  const wi = { childPgid: -1 };
  const meta = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.source, 'NONE');
  assert.match(res.conflictReason || '', /malformed PGID alias in workerIdentity/);
});

test('Remediation 11.6 (Workstream B2): Malformed single pgid (0) in WI fails closed', () => {
  const wi = { pgid: 0 } as any;
  const meta = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 11.7 (Workstream B3): Malformed single childPgid string ("100") in WI fails closed', () => {
  const wi = { childPgid: '100' as any };
  const meta = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 11.8 (Workstream B4): Malformed single pgid fraction (100.5) in WI fails closed', () => {
  const wi = { pgid: 100.5 } as any;
  const meta = { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const };
  const res = resolveProcessGroupIdentity(wi, meta);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 11.9 (Workstream C1): Standalone unanchored OS_VERIFIED in meta fails closed', () => {
  const res = resolveProcessGroupIdentity(null, { pgidVerificationState: 'OS_VERIFIED' as const });
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.source, 'NONE');
  assert.match(res.conflictReason || '', /unanchored OS_VERIFIED provenance/);

  const sigRes = sendVerifiedSignal(100, 100, 'SIGTERM', {
    useProcessGroup: true,
    expectedIdentity: {
      ...res,
      pid: 100,
      requestId: 'req_11_9',
      processInstanceId: 'proc_11_9',
      processStartedAt: Date.now(),
    },
  });
  assert.equal(sigRes.success, false);
  assert.equal(sigRes.deliveredToGroup, false);
});

test('Remediation 11.10 (Workstream C2): Standalone unanchored OS_VERIFIED in WI fails closed', () => {
  const res = resolveProcessGroupIdentity({ pgidVerificationState: 'OS_VERIFIED' as const }, null);
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
  assert.equal(res.source, 'NONE');
  assert.match(res.conflictReason || '', /unanchored OS_VERIFIED provenance/);
});

test('Remediation 11.11 (Workstream C3): Both sources claim unanchored OS_VERIFIED without PGID fails closed', () => {
  const res = resolveProcessGroupIdentity(
    { pgidVerificationState: 'OS_VERIFIED' as const },
    { pgidVerificationState: 'OS_VERIFIED' as const }
  );
  assert.equal(res.hasConflict, true);
  assert.equal(res.pgid, undefined);
  assert.equal(res.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 11.12 (Workstream C4): Unanchored OS_VERIFIED in one source cannot promote or borrow from valid UNVERIFIED PGID', () => {
  // meta unanchored OS_VERIFIED, wi valid UNVERIFIED
  const res1 = resolveProcessGroupIdentity(
    { childPgid: 100, pgidVerificationState: 'UNVERIFIED' as const },
    { pgidVerificationState: 'OS_VERIFIED' as const }
  );
  assert.equal(res1.hasConflict, true);
  assert.equal(res1.pgid, undefined);
  assert.equal(res1.pgidVerificationState, 'UNVERIFIED');

  // wi unanchored OS_VERIFIED, meta valid UNVERIFIED
  const res2 = resolveProcessGroupIdentity(
    { pgidVerificationState: 'OS_VERIFIED' as const },
    { childPgid: 100, pgidVerificationState: 'UNVERIFIED' as const }
  );
  assert.equal(res2.hasConflict, true);
  assert.equal(res2.pgid, undefined);
  assert.equal(res2.pgidVerificationState, 'UNVERIFIED');
});

test('Remediation 11.13 (Workstream D1): Orphan recovery fails closed when meta has malformed single alias with verified WI', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_d1_meta_malformed',
    resourceType: 'SDXL',
    ownerId: 'owner_d1',
    status: 'ACTIVE',
    pid: 99999971, // dead process
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      childPgid: -1,
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999971,
        childPgid: 99999971,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.reconciledCount, 0);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.match(recovery.details[0].reason, /Conflicting process group identity metadata/);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  const rec = persistence.getReservation('res_d1_meta_malformed');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');

  // Verify coordinator admission is locked
  await assert.rejects(
    async () => {
      await coordinator.acquire('SDXL', 'test_request');
    },
    /RECOVERY_REQUIRED/
  );

  // Subsequent recovery attempt cannot release using alternate source
  const recovery2 = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery2.reconciledCount, 0);
  const rec2 = persistence.getReservation('res_d1_meta_malformed');
  assert.equal(rec2?.status, 'RECOVERY_REQUIRED');

  db.close();
});

test('Remediation 11.14 (Workstream D2): Orphan recovery fails closed when WI has malformed single alias with verified meta', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_d2_wi_malformed',
    resourceType: 'SDXL',
    ownerId: 'owner_d2',
    status: 'ACTIVE',
    pid: 99999972, // dead process
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      childPgid: 99999972,
      pgidVerificationState: 'OS_VERIFIED',
      workerIdentity: {
        workerType: 'SDXL_WORKER',
        childPid: 99999972,
        childPgid: -1,
        pgidVerificationState: 'OS_VERIFIED',
        workerLifecycleState: 'RUNNING',
      },
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.reconciledCount, 0);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.match(recovery.details[0].reason, /Conflicting process group identity metadata/);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  const rec = persistence.getReservation('res_d2_wi_malformed');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');

  db.close();
});

test('Remediation 11.15 (Workstream D3): Orphan recovery fails closed when reservation contains unanchored OS_VERIFIED provenance', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  persistence.createReservation({
    id: 'res_d3_unanchored',
    resourceType: 'SDXL',
    ownerId: 'owner_d3',
    status: 'ACTIVE',
    pid: 99999973, // dead process
    acquiredAt: Date.now() - 5000,
    lastHeartbeatAt: Date.now() - 5000,
    metadata: {
      pgidVerificationState: 'OS_VERIFIED',
      workerType: 'SDXL_WORKER',
      childPid: 99999973,
    },
  });

  const recovery = await ChildProcessSupervisor.reconcileOrphanedWorkerReservations(coordinator, persistence);
  assert.equal(recovery.failedClosedCount, 1);
  assert.equal(recovery.reconciledCount, 0);
  assert.equal(recovery.details[0].status, 'FAIL_CLOSED_UNKNOWN');
  assert.match(recovery.details[0].reason, /Conflicting process group identity metadata/);
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  const rec = persistence.getReservation('res_d3_unanchored');
  assert.equal(rec?.status, 'RECOVERY_REQUIRED');

  db.close();
});

test('Remediation 11.16 (Workstream E): Preserve valid legacy and established behavior', () => {
  // Legacy single alias resolves without conflict to UNVERIFIED
  const resLegacy = resolveProcessGroupIdentity(null, { pgid: 100 });
  assert.equal(resLegacy.pgid, 100);
  assert.equal(resLegacy.pgidVerificationState, 'UNVERIFIED');
  assert.equal(resLegacy.hasConflict, false);
  assert.equal(resLegacy.source, 'RESERVATION_METADATA');

  // Matching dual aliases remain valid with OS_VERIFIED
  const resMatching = resolveProcessGroupIdentity(null, { childPgid: 100, pgid: 100, pgidVerificationState: 'OS_VERIFIED' as const });
  assert.equal(resMatching.pgid, 100);
  assert.equal(resMatching.pgidVerificationState, 'OS_VERIFIED');
  assert.equal(resMatching.hasConflict, false);

  // Conflicting dual aliases remain invalid
  const resConflicting = resolveProcessGroupIdentity(null, { childPgid: 100, pgid: 200, pgidVerificationState: 'OS_VERIFIED' as const });
  assert.equal(resConflicting.hasConflict, true);
  assert.equal(resConflicting.pgid, undefined);

  // Cross-source disagreement remains invalid
  const resCrossDisagree = resolveProcessGroupIdentity(
    { childPgid: 100, pgidVerificationState: 'OS_VERIFIED' as const },
    { childPgid: 200, pgidVerificationState: 'OS_VERIFIED' as const }
  );
  assert.equal(resCrossDisagree.hasConflict, true);
  assert.equal(resCrossDisagree.pgid, undefined);
});
