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

  // Wait a moment for spawn event to fire
  await new Promise((r) => setTimeout(r, 15));

  // Check database during execution: PID and RUNNING state must be durably recorded
  const activeRecord = persistence.getReservation(reservation.id);
  assert.ok(activeRecord);
  assert.ok(activeRecord.pid && activeRecord.pid > 0, 'childPid must be durably recorded in reservation.pid');

  const meta = activeRecord.metadata as Record<string, unknown>;
  const identity = meta.workerIdentity as WorkerIdentityMetadata;
  assert.ok(identity, 'workerIdentity must be persisted');
  assert.equal(identity.childPid, supervisor.getPid());
  assert.equal(identity.workerLifecycleState, 'RUNNING');
  assert.ok(identity.spawnConfirmedAt && identity.spawnConfirmedAt > 0);

  const result = await execPromise;
  assert.equal(result.success, true);
  await reservation.release();
  db.close();
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

test('Remediation 7b: Startup recovery cleanly reclaims reservation with dead child PID', async () => {
  const db = createTestDatabase();
  const persistence = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence });

  // Fake confirmed dead PID
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
