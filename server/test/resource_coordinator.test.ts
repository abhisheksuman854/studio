/**
 * Phase 2.3.1: Resource Coordinator Core & Safe Admission Control Test Suite
 * 
 * Verifies admission control, compatibility policy, strict serialization,
 * FIFO queueing, cancellation, timeouts, ownership enforcement, idempotent release,
 * migration 011 durability, fail-closed recovery, and state machine consistency.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../db.js';
import {
  ResourceCoordinator,
  ResourceCompatibilityPolicy,
  SQLitePersistenceAdapter,
  ResourceCoordinatorError,
  RESOURCE_TYPES,
  type IResourceProviderLifecycle,
  type ProcessLivenessChecker,
  type ProcessLivenessStatus,
  type ResourceType,
  type Reservation,
} from '../coordinator/index.js';

function getScratchDbPath(prefix = 'res_coord_test'): { dbPath: string; cleanup: () => void } {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const dbPath = path.join(
    scratchDir,
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
  );
  return {
    dbPath,
    cleanup: () => {
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
        if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
      } catch {}
    },
  };
}

// =========================================================================
// Category 1: Admission & Exclusivity
// =========================================================================

test('Category 1: Admission & Exclusivity - LLM + LLM serialization', async () => {
  const coordinator = new ResourceCoordinator();

  const res1 = await coordinator.acquire('LLM', 'owner-a');
  assert.equal(res1.resourceType, 'LLM');
  assert.equal(res1.ownerId, 'owner-a');
  assert.equal(coordinator.getState(), 'ACTIVE');

  let res2Resolved = false;
  let res2Handle: Reservation | null = null;
  const res2Promise = coordinator.acquire('LLM', 'owner-b').then((res) => {
    res2Resolved = true;
    res2Handle = res;
    return res;
  });

  // Small delay to allow microtask processing
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(res2Resolved, false, 'Second LLM request must remain queued while first is active');
  assert.equal(coordinator.getSnapshot().queue.length, 1);

  // Release res1
  const release1 = await res1.release();
  assert.equal(release1.success, true);
  assert.equal(release1.alreadyReleased, false);

  // Now res2 must resolve
  const res2 = await res2Promise;
  assert.equal(res2Resolved, true, 'Second LLM request admitted after first release');
  assert.ok(res2);
  assert.equal(res2.ownerId, 'owner-b');

  await res2.release();
  assert.equal(coordinator.getState(), 'IDLE');
});

test('Category 1: Admission & Exclusivity - SDXL denies concurrent admission with any workload', async () => {
  const coordinator = new ResourceCoordinator();

  // Test 1: SDXL active -> all other resources queued
  const sdxlRes = await coordinator.acquire('SDXL', 'owner-sdxl');
  assert.equal(sdxlRes.resourceType, 'SDXL');

  let otherResolved = false;
  const otherTypes: ResourceType[] = ['LLM', 'SDXL', 'CPU_VIDEO_RENDER', 'AUDIO_PROCESSING'];
  const promises = otherTypes.map((t, idx) =>
    coordinator.acquire(t, `owner-${idx}`).then(() => {
      otherResolved = true;
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(otherResolved, false, 'No resource can be admitted while SDXL is active');
  assert.equal(coordinator.getSnapshot().queue.length, 4);

  // Clean up by shutting down
  await coordinator.shutdown();
  for (const p of promises) {
    await assert.rejects(p, (err: any) => err.code === 'SHUTDOWN');
  }
});

test('Category 1: Admission & Exclusivity - CPU video render and audio processing mutual exclusivity', async () => {
  const coordinator = new ResourceCoordinator();

  const renderRes = await coordinator.acquire('CPU_VIDEO_RENDER', 'owner-render');
  assert.equal(renderRes.resourceType, 'CPU_VIDEO_RENDER');

  let audioResolved = false;
  const audioPromise = coordinator.acquire('AUDIO_PROCESSING', 'owner-audio').then((res) => {
    audioResolved = true;
    return res;
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(audioResolved, false, 'Audio processing must not be admitted concurrently with CPU render');

  await renderRes.release();
  const audioRes = await audioPromise;
  assert.equal(audioResolved, true);
  assert.equal(audioRes.resourceType, 'AUDIO_PROCESSING');

  await audioRes.release();
  assert.equal(coordinator.getState(), 'IDLE');
});

test('Category 1: Admission & Exclusivity - Valid vs invalid resource types', async () => {
  const coordinator = new ResourceCoordinator();

  assert.equal(ResourceCompatibilityPolicy.isValidResourceType('LLM'), true);
  assert.equal(ResourceCompatibilityPolicy.isValidResourceType('SDXL'), true);
  assert.equal(ResourceCompatibilityPolicy.isValidResourceType('CPU_VIDEO_RENDER'), true);
  assert.equal(ResourceCompatibilityPolicy.isValidResourceType('AUDIO_PROCESSING'), true);
  assert.equal(ResourceCompatibilityPolicy.isValidResourceType('GPU_RENDER'), false);
  assert.equal(ResourceCompatibilityPolicy.isValidResourceType(''), false);

  await assert.rejects(
    coordinator.acquire('UNKNOWN_RESOURCE' as any, 'owner-invalid'),
    (err: any) => {
      assert.ok(err instanceof ResourceCoordinatorError);
      assert.equal(err.code, 'INVALID_RESOURCE');
      return true;
    }
  );

  await assert.rejects(
    coordinator.acquire('LLM', ''),
    (err: any) => {
      assert.ok(err instanceof ResourceCoordinatorError);
      assert.equal(err.code, 'WRONG_OWNER');
      return true;
    }
  );
});

// =========================================================================
// Category 2: Queue & Cancellation
// =========================================================================

test('Category 2: Queue & Cancellation - FIFO queue order under serialized admission', async () => {
  const coordinator = new ResourceCoordinator();

  const res1 = await coordinator.acquire('LLM', 'owner-1');

  const executionOrder: string[] = [];

  const p2 = coordinator.acquire('LLM', 'owner-2').then(async (res) => {
    executionOrder.push('owner-2');
    await res.release();
  });

  const p3 = coordinator.acquire('LLM', 'owner-3').then(async (res) => {
    executionOrder.push('owner-3');
    await res.release();
  });

  const p4 = coordinator.acquire('LLM', 'owner-4').then(async (res) => {
    executionOrder.push('owner-4');
    await res.release();
  });

  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.queue.length, 3);
  assert.equal(snapshot.queue[0].ownerId, 'owner-2');
  assert.equal(snapshot.queue[1].ownerId, 'owner-3');
  assert.equal(snapshot.queue[2].ownerId, 'owner-4');

  await res1.release();
  await Promise.all([p2, p3, p4]);

  assert.deepEqual(executionOrder, ['owner-2', 'owner-3', 'owner-4'], 'Admissions must execute in strict FIFO order');
  assert.equal(coordinator.getState(), 'IDLE');
});

test('Category 2: Queue & Cancellation - Explicit cancellation while queued', async () => {
  const coordinator = new ResourceCoordinator();

  const res1 = await coordinator.acquire('LLM', 'owner-1');

  let p2Admitted = false;
  const p2 = coordinator.acquire('LLM', 'owner-2', { customReservationId: 'res-queued-2' });
  const p3 = coordinator.acquire('LLM', 'owner-3', { customReservationId: 'res-queued-3' });

  // Cancel queued item 2
  const cancelled = coordinator.cancel('res-queued-2', 'owner-2');
  assert.equal(cancelled, true);

  await assert.rejects(p2, (err: any) => {
    assert.ok(err instanceof ResourceCoordinatorError);
    assert.equal(err.code, 'CANCELLED');
    return true;
  });

  // Verify wrong owner cannot cancel
  assert.throws(
    () => coordinator.cancel('res-queued-3', 'wrong-owner'),
    (err: any) => err.code === 'WRONG_OWNER'
  );

  // Releasing res1 should immediately admit res3, skipping cancelled res2
  let res3Handle: Reservation | null = null;
  const p3Finish = p3.then((res) => {
    res3Handle = res;
    return res;
  });

  await res1.release();
  const res3 = await p3Finish;

  assert.ok(res3);
  assert.equal(res3.id, 'res-queued-3');
  assert.equal(res3.ownerId, 'owner-3');

  await res3.release();
  assert.equal(coordinator.getState(), 'IDLE');
  assert.equal(coordinator.getSnapshot().metrics.totalCancelled, 1);
});

test('Category 2: Queue & Cancellation - Admission timeout expiry while queued', async () => {
  const coordinator = new ResourceCoordinator();

  const res1 = await coordinator.acquire('LLM', 'owner-1');

  const p2 = coordinator.acquire('LLM', 'owner-2', { timeoutMs: 50 });

  // Wait for timeout to expire
  await assert.rejects(p2, (err: any) => {
    assert.ok(err instanceof ResourceCoordinatorError);
    assert.equal(err.code, 'TIMEOUT');
    return true;
  });

  assert.equal(coordinator.getSnapshot().metrics.totalTimedOut, 1);
  assert.equal(coordinator.getSnapshot().queue.length, 0);

  // When res1 releases, timed-out request is never admitted
  await res1.release();
  assert.equal(coordinator.getState(), 'IDLE');
});

// =========================================================================
// Category 3: Ownership & Lifecycle
// =========================================================================

test('Category 3: Ownership & Lifecycle - Unique reservation ID generation', async () => {
  const coordinator = new ResourceCoordinator();

  const ids = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const res = await coordinator.acquire('LLM', `owner-${i}`);
    assert.ok(res.id.startsWith('resv_'));
    assert.ok(!ids.has(res.id), `ID ${res.id} must be unique`);
    ids.add(res.id);
    await res.release();
  }
  assert.equal(ids.size, 10);
});

test('Category 3: Ownership & Lifecycle - Release rejected if caller is not the owner', async () => {
  const coordinator = new ResourceCoordinator();

  const res = await coordinator.acquire('LLM', 'legitimate-owner');

  await assert.rejects(
    coordinator.release(res.id, 'rogue-imposter'),
    (err: any) => {
      assert.ok(err instanceof ResourceCoordinatorError);
      assert.equal(err.code, 'WRONG_OWNER');
      return true;
    }
  );

  // Release with legitimate owner succeeds
  const releaseRes = await res.release();
  assert.equal(releaseRes.success, true);
  assert.equal(releaseRes.alreadyReleased, false);
});

test('Category 3: Ownership & Lifecycle - Idempotent release for repeated calls by same owner', async () => {
  const coordinator = new ResourceCoordinator();

  const res = await coordinator.acquire('LLM', 'owner-idem');

  const firstRelease = await res.release();
  assert.equal(firstRelease.success, true);
  assert.equal(firstRelease.alreadyReleased, false);

  const secondRelease = await res.release();
  assert.equal(secondRelease.success, true);
  assert.equal(secondRelease.alreadyReleased, true);

  const directSecondRelease = await coordinator.release(res.id, 'owner-idem');
  assert.equal(directSecondRelease.success, true);
  assert.equal(directSecondRelease.alreadyReleased, true);
});

test('Category 3: Ownership & Lifecycle - Active reservations protected during shutdown', async () => {
  const coordinator = new ResourceCoordinator();

  const activeRes = await coordinator.acquire('LLM', 'owner-active');

  let queuedRejected = false;
  const queuedPromise = coordinator.acquire('LLM', 'owner-queued').catch((err) => {
    if (err.code === 'SHUTDOWN') queuedRejected = true;
  });

  await coordinator.shutdown();
  await queuedPromise;

  assert.equal(queuedRejected, true, 'Queued requests must be rejected on shutdown');
  assert.equal(coordinator.getState(), 'SHUTDOWN');
  assert.equal(activeRes.getStatus(), 'ACTIVE', 'Active reservation must remain protected during shutdown');

  // New acquisitions must be rejected with SHUTDOWN
  await assert.rejects(
    coordinator.acquire('LLM', 'new-owner'),
    (err: any) => err.code === 'SHUTDOWN'
  );

  // Active reservation can still be cleanly released by its owner
  const releaseRes = await activeRes.release();
  assert.equal(releaseRes.success, true);
});

// =========================================================================
// Category 4: Recovery & Persistence
// =========================================================================

test('Category 4: Recovery & Persistence - Migration runner 011 fresh initialization and idempotency', (t) => {
  const { dbPath, cleanup } = getScratchDbPath('mig011_test');
  t.after(cleanup);

  // 1. Fresh database initialization
  const db = openDb(dbPath);
  const migRecord = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('011_resource_coordination.sql');
  assert.ok(migRecord, 'Migration 011 must be registered in _migrations');

  // Verify table structure
  const tableInfo = db.prepare('PRAGMA table_info(resource_reservations)').all() as any[];
  const colNames = tableInfo.map((c) => c.name);
  assert.ok(colNames.includes('id'));
  assert.ok(colNames.includes('resourceType'));
  assert.ok(colNames.includes('ownerId'));
  assert.ok(colNames.includes('status'));
  assert.ok(colNames.includes('pid'));
  assert.ok(colNames.includes('acquiredAt'));
  assert.ok(colNames.includes('lastHeartbeatAt'));
  assert.ok(colNames.includes('releasedAt'));
  assert.ok(colNames.includes('failureReason'));
  assert.ok(colNames.includes('metadata'));

  // Verify indices
  const indexInfo = db.prepare('PRAGMA index_list(resource_reservations)').all() as any[];
  const indexNames = indexInfo.map((i) => i.name);
  assert.ok(indexNames.includes('idx_resource_reservations_status'));
  assert.ok(indexNames.includes('idx_resource_reservations_owner'));
  assert.ok(indexNames.includes('idx_resource_reservations_type_status'));

  db.close();

  // 2. Idempotent re-opening
  const db2 = openDb(dbPath);
  const migCount = db2.prepare('SELECT count(*) as c FROM _migrations WHERE name = ?').get('011_resource_coordination.sql') as any;
  assert.equal(migCount.c, 1, 'Migration 011 must not re-run or duplicate');
  db2.close();
});

test('Category 4: Recovery & Persistence - Unresolved reservations detected on startup fail-closed', (t) => {
  const { dbPath, cleanup } = getScratchDbPath('unresolved_startup');
  t.after(cleanup);

  const db = openDb(dbPath);
  const adapter = new SQLitePersistenceAdapter(db);

  // Insert a dangling active reservation
  adapter.createReservation({
    id: 'res_dangling_1',
    resourceType: 'LLM',
    ownerId: 'crashed-worker',
    status: 'ACTIVE',
    pid: 999999,
    acquiredAt: Date.now() - 60000,
    lastHeartbeatAt: Date.now() - 30000,
  });

  // Coordinator startup should detect unresolved reservation and enter RECOVERY_REQUIRED
  const coordinator = new ResourceCoordinator({ persistence: adapter });
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Must reject new admissions fail-closed
  assert.rejects(
    coordinator.acquire('LLM', 'new-requester'),
    (err: any) => err.code === 'RECOVERY_REQUIRED'
  );

  db.close();
});

test('Category 4: Recovery & Persistence - Expired heartbeat with live process fails closed', async (t) => {
  const { dbPath, cleanup } = getScratchDbPath('live_proc_fail_closed');
  t.after(cleanup);

  const db = openDb(dbPath);
  const adapter = new SQLitePersistenceAdapter(db);

  adapter.createReservation({
    id: 'res_live_dangling',
    resourceType: 'LLM',
    ownerId: 'worker-live',
    status: 'ACTIVE',
    pid: 12345,
    acquiredAt: Date.now() - 100000,
    lastHeartbeatAt: Date.now() - 50000,
  });

  const mockLiveness: ProcessLivenessChecker = {
    isProcessAlive: (pid: number): ProcessLivenessStatus => {
      assert.equal(pid, 12345);
      return true; // Process is still running!
    },
  };

  const coordinator = new ResourceCoordinator({
    persistence: adapter,
    processLiveness: mockLiveness,
  });

  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  const recoveryResult = await coordinator.recover(undefined, { isSystemPrivileged: true });
  assert.equal(recoveryResult.recovered, false);
  assert.equal(recoveryResult.reason, 'PROCESS_STILL_ALIVE');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  const persisted = adapter.getReservation('res_live_dangling');
  assert.equal(persisted?.status, 'RECOVERY_REQUIRED');

  db.close();
});

test('Category 4: Recovery & Persistence - Expired heartbeat with dead process reclaims safely', async (t) => {
  const { dbPath, cleanup } = getScratchDbPath('dead_proc_reclaim');
  t.after(cleanup);

  const db = openDb(dbPath);
  const adapter = new SQLitePersistenceAdapter(db);

  adapter.createReservation({
    id: 'res_dead_dangling',
    resourceType: 'LLM',
    ownerId: 'worker-dead',
    status: 'ACTIVE',
    pid: 54321,
    acquiredAt: Date.now() - 100000,
    lastHeartbeatAt: Date.now() - 50000,
  });

  const mockLiveness: ProcessLivenessChecker = {
    isProcessAlive: (pid: number): ProcessLivenessStatus => {
      assert.equal(pid, 54321);
      return false; // Process is definitely dead!
    },
  };

  const mockProvider: IResourceProviderLifecycle = {
    resourceType: 'LLM',
    isAvailable: async () => true,
    getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }), // Confirms provider is explicitly NOT_RESIDENT
    prepareForRelease: async () => {},
    release: async () => {},
    verifyReleased: async () => true,
  };

  const providers = new Map<ResourceType, IResourceProviderLifecycle>([['LLM', mockProvider]]);

  const coordinator = new ResourceCoordinator({
    persistence: adapter,
    processLiveness: mockLiveness,
    providers,
  });

  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  const recoveryResult = await coordinator.recover(undefined, { isSystemPrivileged: true });
  assert.equal(recoveryResult.recovered, true);
  assert.equal(coordinator.getState(), 'IDLE');

  const persisted = adapter.getReservation('res_dead_dangling');
  assert.equal(persisted?.status, 'RELEASED');
  assert.equal(coordinator.getSnapshot().metrics.totalRecoveries, 1);

  // New acquisitions should now succeed cleanly
  const newRes = await coordinator.acquire('LLM', 'new-owner');
  assert.equal(newRes.getStatus(), 'ACTIVE');
  await newRes.release();

  db.close();
});

test('Category 4: Recovery & Persistence - Unverified process state fails closed', async (t) => {
  const { dbPath, cleanup } = getScratchDbPath('unverified_proc_fail_closed');
  t.after(cleanup);

  const db = openDb(dbPath);
  const adapter = new SQLitePersistenceAdapter(db);

  // Subcase A: Missing PID in reservation
  adapter.createReservation({
    id: 'res_no_pid',
    resourceType: 'LLM',
    ownerId: 'worker-unknown',
    status: 'ACTIVE',
    acquiredAt: Date.now() - 100000,
    lastHeartbeatAt: Date.now() - 50000,
  });

  const coordinatorA = new ResourceCoordinator({ persistence: adapter });
  const resA = await coordinatorA.recover('res_no_pid', { isSystemPrivileged: true });
  assert.equal(resA.recovered, false);
  assert.equal(resA.reason, 'UNVERIFIED_PROCESS_STATE');
  assert.equal(coordinatorA.getState(), 'RECOVERY_REQUIRED');

  // Subcase B: Liveness checker returns 'UNKNOWN'
  adapter.createReservation({
    id: 'res_unknown_liveness',
    resourceType: 'LLM',
    ownerId: 'worker-unknown-live',
    status: 'ACTIVE',
    pid: 77777,
    acquiredAt: Date.now() - 100000,
    lastHeartbeatAt: Date.now() - 50000,
  });

  const mockUnknownLiveness: ProcessLivenessChecker = {
    isProcessAlive: () => 'UNKNOWN',
  };

  const coordinatorB = new ResourceCoordinator({
    persistence: adapter,
    processLiveness: mockUnknownLiveness,
  });
  const resB = await coordinatorB.recover('res_unknown_liveness', { isSystemPrivileged: true });
  assert.equal(resB.recovered, false);
  assert.equal(resB.reason, 'UNVERIFIED_PROCESS_STATE');
  assert.equal(coordinatorB.getState(), 'RECOVERY_REQUIRED');

  db.close();
});

test('Category 4: Recovery & Persistence - Provider still loaded during recovery fails closed', async (t) => {
  const { dbPath, cleanup } = getScratchDbPath('provider_loaded_fail_closed');
  t.after(cleanup);

  const db = openDb(dbPath);
  const adapter = new SQLitePersistenceAdapter(db);

  adapter.createReservation({
    id: 'res_prov_loaded',
    resourceType: 'SDXL',
    ownerId: 'worker-sdxl',
    status: 'ACTIVE',
    pid: 88888,
    acquiredAt: Date.now() - 100000,
    lastHeartbeatAt: Date.now() - 50000,
  });

  const mockDeadLiveness: ProcessLivenessChecker = {
    isProcessAlive: () => false,
  };

  const mockLoadedProvider: IResourceProviderLifecycle = {
    resourceType: 'SDXL',
    isAvailable: async () => true,
    getStatus: async () => ({ loaded: true, residency: 'RESIDENT', providerState: 'VRAM_OCCUPIED' }),
    prepareForRelease: async () => {},
    release: async () => {},
    verifyReleased: async () => false,
  };

  const providers = new Map<ResourceType, IResourceProviderLifecycle>([['SDXL', mockLoadedProvider]]);

  const coordinator = new ResourceCoordinator({
    persistence: adapter,
    processLiveness: mockDeadLiveness,
    providers,
  });

  const res = await coordinator.recover('res_prov_loaded', { isSystemPrivileged: true });
  assert.equal(res.recovered, false);
  assert.equal(res.reason, 'PROVIDER_STILL_LOADED');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  db.close();
});

test('Category 4: Recovery & Persistence - No TTL-only reclamation without verified dead process and provider', async (t) => {
  const { dbPath, cleanup } = getScratchDbPath('no_ttl_only_reclaim');
  t.after(cleanup);

  const db = openDb(dbPath);
  const adapter = new SQLitePersistenceAdapter(db);

  // Create a reservation whose heartbeat was 48 hours ago
  const fortyEightHoursAgo = Date.now() - 48 * 3600 * 1000;
  adapter.createReservation({
    id: 'res_ancient_heartbeat',
    resourceType: 'CPU_VIDEO_RENDER',
    ownerId: 'render-job',
    status: 'ACTIVE',
    pid: 99991,
    acquiredAt: fortyEightHoursAgo,
    lastHeartbeatAt: fortyEightHoursAgo,
  });

  // Process is alive
  const liveChecker: ProcessLivenessChecker = {
    isProcessAlive: () => true,
  };

  const coordinator = new ResourceCoordinator({
    persistence: adapter,
    processLiveness: liveChecker,
  });

  // Attempting recovery MUST fail closed even though timestamp is ancient
  const rec = await coordinator.recover('res_ancient_heartbeat', { isSystemPrivileged: true });
  assert.equal(rec.recovered, false);
  assert.equal(rec.reason, 'PROCESS_STILL_ALIVE');
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  db.close();
});

// =========================================================================
// Category 5: State Consistency
// =========================================================================

test('Category 5: State Consistency - Coordinator and reservation lifecycle transitions', async () => {
  const lifecycleEvents: string[] = [];

  const mockProvider: IResourceProviderLifecycle = {
    resourceType: 'LLM',
    isAvailable: async () => true,
    getStatus: async () => ({ loaded: true }),
    prepareForRelease: async () => {
      lifecycleEvents.push('prepareForRelease');
    },
    release: async () => {
      lifecycleEvents.push('release');
    },
    verifyReleased: async () => {
      lifecycleEvents.push('verifyReleased');
      return true;
    },
  };

  const providers = new Map<ResourceType, IResourceProviderLifecycle>([['LLM', mockProvider]]);
  const coordinator = new ResourceCoordinator({ providers });

  assert.equal(coordinator.getState(), 'IDLE');

  const res = await coordinator.acquire('LLM', 'owner-cycle');
  assert.equal(coordinator.getState(), 'ACTIVE');
  assert.equal(res.getStatus(), 'ACTIVE');

  await res.release();
  assert.equal(coordinator.getState(), 'IDLE');
  assert.equal(res.getStatus(), 'RELEASED');

  assert.deepEqual(lifecycleEvents, ['prepareForRelease', 'release', 'verifyReleased']);
});

test('Category 5: State Consistency - Snapshot accurately reflects active reservation and queue depth', async () => {
  const coordinator = new ResourceCoordinator();

  const emptySnap = coordinator.getSnapshot();
  assert.equal(emptySnap.coordinatorState, 'IDLE');
  assert.equal(emptySnap.activeReservation, null);
  assert.equal(emptySnap.queue.length, 0);

  const res1 = await coordinator.acquire('LLM', 'owner-1', { pid: 1111 });
  const p2 = coordinator.acquire('LLM', 'owner-2', { pid: 2222 });
  const p3 = coordinator.acquire('LLM', 'owner-3', { pid: 3333 });

  const busySnap = coordinator.getSnapshot();
  assert.equal(busySnap.coordinatorState, 'ACTIVE');
  assert.ok(busySnap.activeReservation);
  assert.equal(busySnap.activeReservation.id, res1.id);
  assert.equal(busySnap.activeReservation.ownerId, 'owner-1');
  assert.equal(busySnap.activeReservation.pid, 1111);
  assert.equal(busySnap.queue.length, 2);
  assert.equal(busySnap.queue[0].ownerId, 'owner-2');
  assert.equal(busySnap.queue[0].queuePosition, 0);
  assert.equal(busySnap.queue[1].ownerId, 'owner-3');
  assert.equal(busySnap.queue[1].queuePosition, 1);

  await res1.release();
  const res2 = await p2;
  await res2.release();
  const res3 = await p3;
  await res3.release();

  const finalSnap = coordinator.getSnapshot();
  assert.equal(finalSnap.coordinatorState, 'IDLE');
  assert.equal(finalSnap.activeReservation, null);
  assert.equal(finalSnap.queue.length, 0);
  assert.equal(finalSnap.metrics.totalAcquired, 3);
  assert.equal(finalSnap.metrics.totalReleased, 3);
});

test('Category 4: Recovery & Persistence - Upgrade legacy database containing migrations 001-010 to 011 and 012', (t) => {
  const { dbPath, cleanup } = getScratchDbPath('legacy_upgrade_010_to_012');
  t.after(cleanup);

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');

  // Apply migrations 001 through 010 manually
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (f.startsWith('011') || f.startsWith('012')) continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }
  db.close();

  // Now run production openDb() runner
  const upgradedDb = openDb(dbPath);
  const mig11 = upgradedDb.prepare('SELECT name FROM _migrations WHERE name = ?').get('011_resource_coordination.sql');
  const mig12 = upgradedDb.prepare('SELECT name FROM _migrations WHERE name = ?').get('012_resource_coordination_canonical_indexes.sql');
  assert.ok(mig11, 'Migration 011 must be applied to legacy database');
  assert.ok(mig12, 'Migration 012 must be applied to legacy database');

  const indexInfo = upgradedDb.prepare('PRAGMA index_list(resource_reservations)').all() as any[];
  const indexNames = indexInfo.map((i) => i.name);
  assert.ok(indexNames.includes('idx_resource_reservations_status'));
  assert.ok(indexNames.includes('idx_resource_reservations_owner'));
  assert.ok(indexNames.includes('idx_resource_reservations_type_status'));
  assert.ok(indexNames.includes('idx_res_resv_status'));

  upgradedDb.close();
});

test('Category 4: Recovery & Persistence - Transaction rollback on migration runner statement failure', (t) => {
  const { dbPath, cleanup } = getScratchDbPath('rollback_test');
  t.after(cleanup);

  const scratchDir = path.dirname(dbPath);
  const tempFixtureDir = path.join(scratchDir, `bad_mig_${Date.now()}`);
  fs.mkdirSync(tempFixtureDir, { recursive: true });
  t.after(() => {
    try { fs.rmSync(tempFixtureDir, { recursive: true, force: true }); } catch {}
  });

  // Valid migration 001
  fs.writeFileSync(path.join(tempFixtureDir, '001_good.sql'), 'CREATE TABLE test_table(id TEXT PRIMARY KEY);');
  // Failing migration 002
  fs.writeFileSync(path.join(tempFixtureDir, '002_broken.sql'), 'CREATE TABLE test_table2(id TEXT); INVALID SYNTAX ERROR;');

  assert.throws(
    () => { openDb(dbPath, tempFixtureDir); },
    (err: any) => err instanceof Error
  );

  const db = new Database(dbPath);
  const applied = db.prepare('SELECT name FROM _migrations').all() as any[];
  assert.equal(applied.length, 1);
  assert.equal(applied[0].name, '001_good.sql');

  // Verify test_table2 was NOT created (rolled back completely)
  const table2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='test_table2'").get();
  assert.equal(table2, undefined, 'Failing migration changes must be rolled back');
  db.close();
});

test('Category 4: Recovery & Persistence - Foreign keys enabled and table constraint enforcement', (t) => {
  const { dbPath, cleanup } = getScratchDbPath('constraints_test');
  t.after(cleanup);

  const db = openDb(dbPath);

  // 1. Verify foreign keys
  const fk = db.pragma('foreign_keys', { simple: true });
  assert.equal(fk, 1, 'PRAGMA foreign_keys must be ON');

  // 2. Primary key duplicate rejection
  const adapter = new SQLitePersistenceAdapter(db);
  adapter.createReservation({
    id: 'res_dup_pk',
    resourceType: 'LLM',
    ownerId: 'owner-1',
    status: 'ACTIVE',
    acquiredAt: Date.now(),
    lastHeartbeatAt: Date.now(),
  });

  assert.throws(
    () => {
      adapter.createReservation({
        id: 'res_dup_pk',
        resourceType: 'LLM',
        ownerId: 'owner-2',
        status: 'ACTIVE',
        acquiredAt: Date.now(),
        lastHeartbeatAt: Date.now(),
      });
    },
    (err: any) => {
      assert.ok(err instanceof ResourceCoordinatorError);
      assert.equal(err.code, 'PERSISTENCE_ERROR');
      return true;
    }
  );

  // 3. NOT NULL constraint rejection
  assert.throws(
    () => {
      db.prepare('INSERT INTO resource_reservations (id, resourceType, ownerId, status, acquiredAt, lastHeartbeatAt) VALUES (?, NULL, ?, ?, ?, ?)')
        .run('res_null_type', 'owner', 'ACTIVE', Date.now(), Date.now());
    },
    (err: any) => err.code === 'SQLITE_CONSTRAINT_NOTNULL'
  );

  db.close();
});

test('Category 4: Recovery & Persistence - Failed release never admits next incompatible request and locks admissions', async (t) => {
  const mockFailingProvider: IResourceProviderLifecycle = {
    resourceType: 'LLM',
    isAvailable: async () => true,
    getStatus: async () => ({ loaded: true }),
    prepareForRelease: async () => {},
    release: async () => {},
    verifyReleased: async () => false, // Fails release verification!
  };

  const providers = new Map<ResourceType, IResourceProviderLifecycle>([['LLM', mockFailingProvider]]);
  const coordinator = new ResourceCoordinator({ providers });

  const res1 = await coordinator.acquire('LLM', 'owner-1');

  let res2Admitted = false;
  const p2 = coordinator.acquire('LLM', 'owner-2').then((res) => {
    res2Admitted = true;
    return res;
  });

  // Releasing res1 must fail because verifyReleased returns false
  await assert.rejects(
    res1.release(),
    (err: any) => {
      assert.ok(err instanceof ResourceCoordinatorError);
      assert.equal(err.code, 'RELEASE_FAILED');
      return true;
    }
  );

  // Coordinator must be in RECOVERY_REQUIRED
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

  // Next request in queue must NOT be admitted
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res2Admitted, false, 'Incompatible/queued request must never be admitted after release failure');

  // New acquisitions must also be rejected
  await assert.rejects(
    coordinator.acquire('LLM', 'owner-new'),
    (err: any) => err.code === 'RECOVERY_REQUIRED'
  );

  // Clean up
  await coordinator.shutdown();
  await assert.rejects(p2, (err: any) => err.code === 'SHUTDOWN');
});

test('Category 5: State Consistency - In-memory coordinator and SQLite ledger cannot silently diverge', async (t) => {
  const { dbPath, cleanup } = getScratchDbPath('divergence_test');
  t.after(cleanup);

  const db = openDb(dbPath);
  const adapter = new SQLitePersistenceAdapter(db);
  const coordinator = new ResourceCoordinator({ persistence: adapter });

  // 1. Acquire: memory and ledger both ACTIVE
  const res = await coordinator.acquire('LLM', 'owner-sync', { pid: 4321 });
  const rowActive = adapter.getReservation(res.id);
  assert.ok(rowActive);
  assert.equal(rowActive.status, 'ACTIVE');
  assert.equal(rowActive.ownerId, 'owner-sync');
  assert.equal(rowActive.pid, 4321);
  assert.equal(coordinator.getState(), 'ACTIVE');
  assert.equal(res.getStatus(), 'ACTIVE');

  // 2. Heartbeat: memory and ledger both updated
  coordinator.heartbeat(res.id, 'owner-sync');
  const rowHeartbeat = adapter.getReservation(res.id);
  assert.ok(rowHeartbeat);
  assert.ok(rowHeartbeat.lastHeartbeatAt >= rowActive.lastHeartbeatAt);

  // 3. Release: memory becomes IDLE, ledger becomes RELEASED with timestamp
  const releaseResult = await res.release();
  assert.equal(releaseResult.success, true);
  assert.equal(coordinator.getState(), 'IDLE');
  assert.equal(res.getStatus(), 'RELEASED');

  const rowReleased = adapter.getReservation(res.id);
  assert.ok(rowReleased);
  assert.equal(rowReleased.status, 'RELEASED');
  assert.ok(rowReleased.releasedAt && rowReleased.releasedAt > 0);

  // Snapshot activeReservation is null
  const snapshot = coordinator.getSnapshot();
  assert.equal(snapshot.activeReservation, null);
  assert.equal(snapshot.coordinatorState, 'IDLE');

  db.close();
});
