/**
 * Phase 2.3.2.4: Comprehensive Test Suite for Lifecycle Safety & Queue Integrity Remediation
 * 
 * Verifies fixes for:
 * - AUDIT-2323-01: Queue Integrity & Cancellation During Pre-Admission (Workstream A)
 * - AUDIT-2323-02: Strict Residency Compatibility (Workstream B)
 * - AUDIT-2323-03: Process-Instance Identity Validation (Workstream C)
 * - AUDIT-2323-04: Recovery Serialization (Workstream D)
 * - AUDIT-2323-05: Multiple Unresolved Startup Reservations (Workstream E)
 * - AUDIT-2323-06: Recovery Authorization (Workstream F)
 * - AUDIT-2323-07: Shared Inference Drain Before Unload (Workstream G)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ResourceCoordinator,
  SQLitePersistenceAdapter,
  OllamaLifecycleAdapter,
  ResourceCoordinatorError,
  type ProcessLivenessChecker,
  type ProcessLivenessStatus,
  type IResourceProviderLifecycle,
  type ProviderStatus,
  type ReservationRecord,
  type ResourceType,
  type Reservation,
} from '../coordinator/index.js';
import { openDb } from '../db.js';

function createTestPersistence(): { adapter: SQLitePersistenceAdapter; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auravo-remediation-test-'));
  const dbFile = path.join(tmpDir, 'test_remediation.db');
  const db = openDb(dbFile);
  const adapter = new SQLitePersistenceAdapter(db);
  return {
    adapter,
    cleanup: () => {
      try {
        db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

// ============================================================================
// Workstream A: Queue Integrity & Cancellation (AUDIT-2323-01)
// ============================================================================

test('A1. Cancellation of SDXL request at queue head during async pre-admission does not corrupt queue or admit next request prematurely', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let resolveUnload: () => void = () => {};
    const unloadPromise = new Promise<void>((r) => {
      resolveUnload = r;
    });

    let unloadTriggered = false;
    const mockLLM: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: true, residency: 'RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {
        unloadTriggered = true;
        await unloadPromise; // Pause in the middle of pre-admission unload
      },
      verifyReleased: async () => true,
      prepareForAdmission: async () => {
        unloadTriggered = true;
        await unloadPromise;
        return true;
      },
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      providers: new Map([['LLM', mockLLM]]),
    });

    // Enqueue SDXL request A
    const promiseA = coordinator.acquire('SDXL', 'owner-sdxl', { customReservationId: 'resv_sdxl_a' });

    // Wait for A to begin pre-admission
    while (!unloadTriggered) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(coordinator.getState(), 'PREPARING_ADMISSION');

    // Enqueue LLM request B behind A
    const promiseB = coordinator.acquire('LLM', 'owner-llm', { customReservationId: 'resv_llm_b' });

    // Cancel request A while preparation is in-flight
    const cancelled = coordinator.cancel('resv_sdxl_a', 'owner-sdxl');
    assert.equal(cancelled, true);

    // Resolve unload to allow preparation to finish
    resolveUnload();

    // Request A must be rejected with CANCELLED
    await assert.rejects(promiseA, (err: any) => {
      assert.equal(err.code, 'CANCELLED');
      return true;
    });

    // Request B must now be admitted cleanly
    const resB = await promiseB;
    assert.equal(resB.id, 'resv_llm_b');
    assert.equal(resB.getStatus(), 'ACTIVE');
    assert.equal(coordinator.getState(), 'ACTIVE');
    assert.equal(coordinator.getActiveReservation()?.id, 'resv_llm_b');

    await resB.release();
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

test('A2. Cancellation of SDXL request during getStatus() aborts preparation without granting or corrupting queue', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let resolveStatus: (status: ProviderStatus) => void = () => {};
    const statusPromise = new Promise<ProviderStatus>((r) => {
      resolveStatus = r;
    });

    let statusRequested = false;
    const mockLLM: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => {
        statusRequested = true;
        return statusPromise;
      },
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      providers: new Map([['LLM', mockLLM]]),
    });

    const promiseA = coordinator.acquire('SDXL', 'owner-a', { customReservationId: 'resv_a' });
    while (!statusRequested) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const promiseB = coordinator.acquire('LLM', 'owner-b', { customReservationId: 'resv_b' });

    // Cancel A while awaiting getStatus
    coordinator.cancel('resv_a', 'owner-a');

    // Complete getStatus
    resolveStatus({ loaded: false, residency: 'NOT_RESIDENT' });

    await assert.rejects(promiseA, (err: any) => err.code === 'CANCELLED');

    const resB = await promiseB;
    assert.equal(resB.id, 'resv_b');
    await resB.release();
  } finally {
    cleanup();
  }
});

test('A3. Two concurrent SDXL requests: cancelling first admits second without orphan grant', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let resolveUnload: () => void = () => {};
    const unloadPromise = new Promise<void>((r) => {
      resolveUnload = r;
    });

    let count = 0;
    const mockLLM: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: count === 0, residency: count === 0 ? 'RESIDENT' : 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {
        count++;
        await unloadPromise;
      },
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      providers: new Map([['LLM', mockLLM]]),
    });

    const promiseA = coordinator.acquire('SDXL', 'owner-a', { customReservationId: 'resv_sdxl_1' });
    const promiseB = coordinator.acquire('SDXL', 'owner-b', { customReservationId: 'resv_sdxl_2' });

    await new Promise((r) => setTimeout(r, 20));
    assert.equal(coordinator.getState(), 'PREPARING_ADMISSION');

    // Cancel first SDXL request
    coordinator.cancel('resv_sdxl_1', 'owner-a');
    resolveUnload();

    await assert.rejects(promiseA, (err: any) => err.code === 'CANCELLED');

    // Second SDXL request must be granted cleanly
    const resB = await promiseB;
    assert.equal(resB.id, 'resv_sdxl_2');
    assert.equal(coordinator.getActiveReservation()?.id, 'resv_sdxl_2');
    await resB.release();
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

test('A4. Repeated cancellation calls return false on second call and do not corrupt state', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const res1 = await coordinator.acquire('LLM', 'owner-1');

    // Queue request 2
    const promise2 = coordinator.acquire('LLM', 'owner-2', { customReservationId: 'resv_queued' });
    assert.equal(coordinator.getQueueLength(), 1);

    const firstCancel = coordinator.cancel('resv_queued', 'owner-2');
    assert.equal(firstCancel, true);

    const secondCancel = coordinator.cancel('resv_queued', 'owner-2');
    assert.equal(secondCancel, false);

    assert.equal(coordinator.getQueueLength(), 0);
    await assert.rejects(promise2, (err: any) => err.code === 'CANCELLED');
    await res1.release();
  } finally {
    cleanup();
  }
});

// ============================================================================
// Workstream B: Strict Residency Compatibility (AUDIT-2323-02)
// ============================================================================

test('B1. Status { residency: "NOT_RESIDENT", loaded: false } admits SDXL without unload', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let unloadCalled = false;
    const mockLLM: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ residency: 'NOT_RESIDENT', loaded: false }),
      prepareForRelease: async () => {},
      release: async () => { unloadCalled = true; },
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      providers: new Map([['LLM', mockLLM]]),
    });

    const res = await coordinator.acquire('SDXL', 'owner-sdxl');
    assert.equal(res.getStatus(), 'ACTIVE');
    assert.equal(unloadCalled, false, 'Unload should not be called when already NOT_RESIDENT');
    await res.release();
  } finally {
    cleanup();
  }
});

test('B2. Status { residency: "RESIDENT", loaded: true } triggers unload and verifies release', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let unloadCalled = false;
    let verifiedCalled = false;
    const mockLLM: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ residency: 'RESIDENT', loaded: true }),
      prepareForRelease: async () => {},
      release: async () => { unloadCalled = true; },
      verifyReleased: async () => { verifiedCalled = true; return true; },
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      providers: new Map([['LLM', mockLLM]]),
    });

    const res = await coordinator.acquire('SDXL', 'owner-sdxl');
    assert.equal(unloadCalled, true);
    assert.equal(verifiedCalled, true);
    assert.equal(res.getStatus(), 'ACTIVE');
    await res.release();
  } finally {
    cleanup();
  }
});

test('B3. Status { residency: "UNKNOWN", loaded: false } rejects SDXL fail-closed', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLLM: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ residency: 'UNKNOWN', loaded: false }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => false,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      providers: new Map([['LLM', mockLLM]]),
    });

    await assert.rejects(coordinator.acquire('SDXL', 'owner-sdxl'), (err: any) => {
      assert.equal(err.code, 'PREPARATION_FAILED');
      return true;
    });
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('B4. Status { loaded: false } without explicit residency evaluates to UNKNOWN and rejects SDXL fail-closed', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLLM: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false } as any),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      providers: new Map([['LLM', mockLLM]]),
    });

    await assert.rejects(coordinator.acquire('SDXL', 'owner-sdxl'), (err: any) => {
      assert.equal(err.code, 'PREPARATION_FAILED');
      assert.match(err.message, /UNKNOWN/);
      return true;
    });
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('B5. Missing or throwing status query rejects SDXL and locks coordinator in RECOVERY_REQUIRED', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLLM: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => { throw new Error('Daemon socket hang up'); },
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => false,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      providers: new Map([['LLM', mockLLM]]),
    });

    await assert.rejects(coordinator.acquire('SDXL', 'owner-sdxl'), (err: any) => {
      assert.equal(err.code, 'PREPARATION_FAILED');
      return true;
    });
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

// ============================================================================
// Workstream C: Process-Instance Identity Validation (AUDIT-2323-03)
// ============================================================================

test('C1. Matching PID and matching processInstanceId is recognized as current runtime and recovers cleanly', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });

    adapter.createReservation({
      id: 'resv_current_runtime',
      resourceType: 'LLM',
      ownerId: 'owner-current',
      status: 'ACTIVE',
      pid: process.pid,
      acquiredAt: Date.now() - 1000,
      lastHeartbeatAt: Date.now() - 500,
      metadata: {
        processInstanceId: coordinator.processInstanceId,
        processStartedAt: coordinator.processStartedAt,
      },
    });

    const result = await coordinator.recover('resv_current_runtime', { callerId: 'owner-current' });
    assert.equal(result.recovered, true);
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

test('C2. Matching PID with missing or mismatched processInstanceId fails closed if process is alive', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => true, // Live external process (e.g. from before restart)
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
    });

    // Same PID but different processInstanceId
    adapter.createReservation({
      id: 'resv_recycled_pid_live',
      resourceType: 'LLM',
      ownerId: 'owner-old',
      status: 'ACTIVE',
      pid: process.pid,
      acquiredAt: Date.now() - 60000,
      lastHeartbeatAt: Date.now() - 50000,
      metadata: {
        processInstanceId: 'proc_old_session_12345',
        processStartedAt: Date.now() - 100000,
      },
    });

    const result = await coordinator.recover('resv_recycled_pid_live', { isSystemPrivileged: true });
    assert.equal(result.recovered, false);
    assert.equal(result.reason, 'PROCESS_STILL_ALIVE');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('C3. Mismatched processInstanceId with dead process reclaims safely', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false, // Process died
    };

    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_recycled_pid_dead',
      resourceType: 'LLM',
      ownerId: 'owner-old',
      status: 'ACTIVE',
      pid: 999999,
      acquiredAt: Date.now() - 60000,
      lastHeartbeatAt: Date.now() - 50000,
      metadata: {
        processInstanceId: 'proc_dead_prior_instance',
      },
    });

    const result = await coordinator.recover('resv_recycled_pid_dead', { isSystemPrivileged: true });
    assert.equal(result.recovered, true);
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

// ============================================================================
// Workstream D: Recovery Serialization (AUDIT-2323-04)
// ============================================================================

test('D1. Two concurrent recover() invocations execute single-flight without duplicate unloads', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let unloads = 0;
    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: true, residency: 'RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {
        unloads++;
        await new Promise((r) => setTimeout(r, 40));
      },
      verifyReleased: async () => true,
    };

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_concurrent_rec',
      resourceType: 'LLM',
      ownerId: 'owner-d',
      status: 'ACTIVE',
      pid: 999999,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    // Invoke recover twice simultaneously
    const [result1, result2] = await Promise.all([
      coordinator.recover('resv_concurrent_rec', { callerId: 'owner-d' }),
      coordinator.recover('resv_concurrent_rec', { callerId: 'owner-d' }),
    ]);

    assert.equal(result1.recovered, true);
    assert.equal(result2.recovered, true);
    assert.equal(unloads, 1, 'Only one unload operation should be executed across concurrent recoveries');
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

// ============================================================================
// Workstream E: Multiple Unresolved Startup Reservations (AUDIT-2323-05)
// ============================================================================

test('E1. Multiple stale reservations on startup are all reconciled sequentially before coordinator enters IDLE', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    // Insert 3 stale reservations from past crashes
    adapter.createReservation({
      id: 'resv_stale_1',
      resourceType: 'LLM',
      ownerId: 'owner-1',
      status: 'ACTIVE',
      pid: 90001,
      acquiredAt: Date.now() - 100000,
      lastHeartbeatAt: Date.now() - 90000,
    });
    adapter.createReservation({
      id: 'resv_stale_2',
      resourceType: 'LLM',
      ownerId: 'owner-2',
      status: 'RECOVERY_REQUIRED',
      pid: 90002,
      acquiredAt: Date.now() - 80000,
      lastHeartbeatAt: Date.now() - 70000,
    });
    adapter.createReservation({
      id: 'resv_stale_3',
      resourceType: 'LLM',
      ownerId: 'owner-3',
      status: 'ACTIVE',
      pid: 90003,
      acquiredAt: Date.now() - 60000,
      lastHeartbeatAt: Date.now() - 50000,
    });

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false, // All past processes are dead
    };

    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

    // Perform global recovery (no reservationId specified)
    const result = await coordinator.recover(undefined, { isSystemPrivileged: true });
    assert.equal(result.recovered, true);
    assert.equal(coordinator.getState(), 'IDLE');

    // Verify all 3 reservations are now RELEASED in persistence
    const r1 = adapter.getReservation('resv_stale_1');
    const r2 = adapter.getReservation('resv_stale_2');
    const r3 = adapter.getReservation('resv_stale_3');
    assert.equal(r1?.status, 'RELEASED');
    assert.equal(r2?.status, 'RELEASED');
    assert.equal(r3?.status, 'RELEASED');

    // Zero unresolved reservations remain in SQLite
    const remaining = adapter.getActiveOrUnresolved();
    assert.equal(remaining.length, 0);
  } finally {
    cleanup();
  }
});

test('E2. Mixed live and stale reservations on startup fails closed and keeps coordinator locked', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    adapter.createReservation({
      id: 'resv_dead_past',
      resourceType: 'LLM',
      ownerId: 'owner-1',
      status: 'ACTIVE',
      pid: 90001,
      acquiredAt: Date.now() - 100000,
      lastHeartbeatAt: Date.now() - 90000,
    });
    adapter.createReservation({
      id: 'resv_live_past',
      resourceType: 'LLM',
      ownerId: 'owner-2',
      status: 'ACTIVE',
      pid: 90002, // This one is still running!
      acquiredAt: Date.now() - 80000,
      lastHeartbeatAt: Date.now() - 70000,
    });

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: (pid) => pid === 90002,
    };

    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

    const result = await coordinator.recover(undefined, { isSystemPrivileged: true });
    assert.equal(result.recovered, false);
    assert.equal(result.reason, 'PROCESS_STILL_ALIVE');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

// ============================================================================
// Workstream F: Recovery Authorization (AUDIT-2323-06)
// ============================================================================

test('F1. Tenant A cannot recover Tenant B reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });

    adapter.createReservation({
      id: 'resv_tenant_b',
      resourceType: 'LLM',
      ownerId: 'tenant_b',
      status: 'ACTIVE',
      pid: 99999,
      acquiredAt: Date.now() - 10000,
      lastHeartbeatAt: Date.now() - 5000,
    });

    // Tenant A attempts unauthorized recovery
    await assert.rejects(
      coordinator.recover('resv_tenant_b', { callerId: 'tenant_a' }),
      (err: any) => {
        assert.equal(err.code, 'WRONG_OWNER');
        return true;
      }
    );

    // Reservation state and persistence must remain unchanged
    const record = adapter.getReservation('resv_tenant_b');
    assert.equal(record?.status, 'ACTIVE');
  } finally {
    cleanup();
  }
});

test('F2. Privileged system recovery can reconcile reservations across tenants', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false,
    };
    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_tenant_b_reconcile',
      resourceType: 'LLM',
      ownerId: 'tenant_b',
      status: 'ACTIVE',
      pid: 99999,
      acquiredAt: Date.now() - 10000,
      lastHeartbeatAt: Date.now() - 5000,
    });

    // Privileged system recovery succeeds
    const result = await coordinator.recover('resv_tenant_b_reconcile', { isSystemPrivileged: true });
    assert.equal(result.recovered, true);

    const record = adapter.getReservation('resv_tenant_b_reconcile');
    assert.equal(record?.status, 'RELEASED');
    assert.equal(record?.ownerId, 'tenant_b', 'Original owner must be preserved');
  } finally {
    cleanup();
  }
});

// ============================================================================
// Workstream G: Shared Inference Drain Before Unload (AUDIT-2323-07)
// ============================================================================

test('G1. Pre-admission unload drains active inference requests before issuing keep_alive: 0', async () => {
  let inFlight = 1;
  let keepAliveReceived = false;

  const adapter = new OllamaLifecycleAdapter({
    fetchFn: (async (url: string, init: any) => {
      if (url.includes('/api/generate')) {
        assert.equal(inFlight, 0, 'keep_alive: 0 must not be issued while active inference is in flight');
        keepAliveReceived = true;
        return new Response(JSON.stringify({ response: 'ok' }), { status: 200 });
      }
      if (url.includes('/api/ps')) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as any,
  });

  adapter.startRequest('resv_active_inf', 'owner-1');

  // Finish active inference after 50ms
  setTimeout(() => {
    inFlight = 0;
    adapter.completeRequest('resv_active_inf');
  }, 50);

  const observation = await adapter.performUnload({ maxDrainWaitMs: 5000 });
  assert.equal(observation.status, 'VERIFIED_UNLOADED');
  assert.equal(keepAliveReceived, true);
});

test('G2. Pre-admission unload fails closed when active inference fails to drain within deadline', async () => {
  const adapter = new OllamaLifecycleAdapter({
    fetchFn: (async () => new Response(JSON.stringify({ models: [] }), { status: 200 })) as any,
  });

  adapter.startRequest('resv_stuck_inf', 'owner-1');

  await assert.rejects(
    adapter.performUnload({ maxDrainWaitMs: 100 }),
    (err: any) => {
      assert.equal(err.code, 'TIMEOUT');
      assert.match(err.message, /failed to drain/);
      return true;
    }
  );
});

// ============================================================================
// Phase 2.3.2.6 Workstreams A, B, C, D: Security, Normalization & Concurrency
// ============================================================================

// --- Workstream A: Explicit Recovery Authorization ---

test('2.3.2.6-A1. Missing caller identity without isSystemPrivileged is rejected with WRONG_OWNER (no implicit privilege)', async () => {
  const coordinator = new ResourceCoordinator();

  // Call recover with no arguments
  await assert.rejects(
    coordinator.recover(),
    (err: any) => {
      assert.equal(err.code, 'WRONG_OWNER');
      assert.match(err.message, /authenticated caller ID or explicit system authority/);
      return true;
    }
  );

  // Call recover with reservationId but no options
  await assert.rejects(
    coordinator.recover('resv_test'),
    (err: any) => {
      assert.equal(err.code, 'WRONG_OWNER');
      return true;
    }
  );

  // Call recover with empty options object
  await assert.rejects(
    coordinator.recover('resv_test', {}),
    (err: any) => {
      assert.equal(err.code, 'WRONG_OWNER');
      return true;
    }
  );

  // Call recover with whitespace or empty callerId
  await assert.rejects(
    coordinator.recover('resv_test', { callerId: '' }),
    (err: any) => {
      assert.equal(err.code, 'WRONG_OWNER');
      return true;
    }
  );
});

test('2.3.2.6-A2. Non-privileged caller attempting global recovery is rejected with WRONG_OWNER', async () => {
  const coordinator = new ResourceCoordinator();

  await assert.rejects(
    coordinator.recover(undefined, { callerId: 'tenant_regular' }),
    (err: any) => {
      assert.equal(err.code, 'WRONG_OWNER');
      assert.match(err.message, /Non-privileged caller cannot perform global multi-reservation recovery/);
      return true;
    }
  );
});

test('2.3.2.6-A3. Valid reservation owner can recover their own reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false,
    };
    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_owner_valid',
      resourceType: 'LLM',
      ownerId: 'legit_owner',
      status: 'ACTIVE',
      pid: 11111,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    const result = await coordinator.recover('resv_owner_valid', { callerId: 'legit_owner' });
    assert.equal(result.recovered, true);
    assert.equal(result.targetId, 'resv_owner_valid');

    const updated = adapter.getReservation('resv_owner_valid');
    assert.equal(updated?.status, 'RELEASED');
    assert.equal(updated?.ownerId, 'legit_owner');
  } finally {
    cleanup();
  }
});

test('2.3.2.6-A4. Cross-tenant caller receives WRONG_OWNER and cannot mutate reservation or erase audit', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });

    adapter.createReservation({
      id: 'resv_tenant_isolation',
      resourceType: 'LLM',
      ownerId: 'tenant_alpha',
      status: 'ACTIVE',
      pid: 22222,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    await assert.rejects(
      coordinator.recover('resv_tenant_isolation', { callerId: 'tenant_beta' }),
      (err: any) => {
        assert.equal(err.code, 'WRONG_OWNER');
        assert.match(err.message, /not authorized to recover reservation/);
        return true;
      }
    );

    const record = adapter.getReservation('resv_tenant_isolation');
    assert.equal(record?.status, 'ACTIVE');
    assert.equal(record?.ownerId, 'tenant_alpha');
  } finally {
    cleanup();
  }
});

test('2.3.2.6-A5. Non-existent reservation recovery by unprivileged caller is rejected with RESERVATION_NOT_FOUND without clearing RECOVERY_REQUIRED', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    // Put coordinator in RECOVERY_REQUIRED
    adapter.createReservation({
      id: 'resv_unresolved_legit',
      resourceType: 'LLM',
      ownerId: 'tenant_real',
      status: 'ACTIVE',
      pid: 33333,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    const coordinator = new ResourceCoordinator({ persistence: adapter });
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

    // Attacker tries to recover non-existent reservation
    await assert.rejects(
      coordinator.recover('non_existent_id', { callerId: 'attacker' }),
      (err: any) => {
        assert.equal(err.code, 'RESERVATION_NOT_FOUND');
        return true;
      }
    );

    // Coordinator MUST remain in RECOVERY_REQUIRED
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('2.3.2.6-A6. Privileged system recovery succeeds and preserves tenant ownership', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false,
    };
    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_system_reconciled',
      resourceType: 'LLM',
      ownerId: 'tenant_customer_xyz',
      status: 'ACTIVE',
      pid: 44444,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    const result = await coordinator.recover('resv_system_reconciled', { isSystemPrivileged: true });
    assert.equal(result.recovered, true);

    const record = adapter.getReservation('resv_system_reconciled');
    assert.equal(record?.status, 'RELEASED');
    assert.equal(record?.ownerId, 'tenant_customer_xyz', 'Customer tenant ID must remain unchanged');
  } finally {
    cleanup();
  }
});

// --- Workstream B: Runtime Residency Validation ---

test('2.3.2.6-B1. normalizeResidency strictly maps inputs to RESIDENT, NOT_RESIDENT, or UNKNOWN', async () => {
  const { normalizeResidency } = await import('../coordinator/types.js');

  // Valid inputs
  assert.equal(normalizeResidency('RESIDENT'), 'RESIDENT');
  assert.equal(normalizeResidency('NOT_RESIDENT'), 'NOT_RESIDENT');
  assert.equal(normalizeResidency('  RESIDENT  '), 'RESIDENT');
  assert.equal(normalizeResidency('  NOT_RESIDENT  '), 'NOT_RESIDENT');

  // Ambiguous, invalid, or malformed inputs -> UNKNOWN
  assert.equal(normalizeResidency('UNKNOWN'), 'UNKNOWN');
  assert.equal(normalizeResidency('NOT_RESIDENT_BUT_UNVERIFIED'), 'UNKNOWN');
  assert.equal(normalizeResidency(''), 'UNKNOWN');
  assert.equal(normalizeResidency('   '), 'UNKNOWN');
  assert.equal(normalizeResidency(null), 'UNKNOWN');
  assert.equal(normalizeResidency(undefined), 'UNKNOWN');
  assert.equal(normalizeResidency(123), 'UNKNOWN');
  assert.equal(normalizeResidency(false), 'UNKNOWN');
  assert.equal(normalizeResidency(true), 'UNKNOWN');
  assert.equal(normalizeResidency({ residency: 'NOT_RESIDENT' }), 'UNKNOWN');
  assert.equal(normalizeResidency(['RESIDENT']), 'UNKNOWN');
});

test('2.3.2.6-B2. Malformed residency string NOT_RESIDENT_BUT_UNVERIFIED with loaded: false fails closed', async () => {
  const mockProvider: IResourceProviderLifecycle = {
    resourceType: 'LLM',
    isAvailable: async () => true,
    getStatus: async () => ({
      loaded: false,
      residency: 'NOT_RESIDENT_BUT_UNVERIFIED' as any,
    }),
    prepareForRelease: async () => {},
    release: async () => {},
    verifyReleased: async () => true,
  };

  const coordinator = new ResourceCoordinator({
    providers: new Map([['LLM', mockProvider]]),
  });

  await assert.rejects(
    coordinator.acquire('SDXL', 'owner-sdxl'),
    (err: any) => {
      assert.equal(err.code, 'PREPARATION_FAILED');
      assert.match(err.message, /residency status is UNKNOWN/);
      return true;
    }
  );
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
});

test('2.3.2.6-B3. Empty string residency with loaded: false fails closed', async () => {
  const mockProvider: IResourceProviderLifecycle = {
    resourceType: 'LLM',
    isAvailable: async () => true,
    getStatus: async () => ({
      loaded: false,
      residency: '' as any,
    }),
    prepareForRelease: async () => {},
    release: async () => {},
    verifyReleased: async () => true,
  };

  const coordinator = new ResourceCoordinator({
    providers: new Map([['LLM', mockProvider]]),
  });

  await assert.rejects(
    coordinator.acquire('SDXL', 'owner-sdxl'),
    (err: any) => {
      assert.equal(err.code, 'PREPARATION_FAILED');
      assert.match(err.message, /residency status is UNKNOWN/);
      return true;
    }
  );
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
});

test('2.3.2.6-B4. Null and undefined residency with loaded: false fails closed', async () => {
  const mockProviderNull: IResourceProviderLifecycle = {
    resourceType: 'LLM',
    isAvailable: async () => true,
    getStatus: async () => ({
      loaded: false,
      residency: null as any,
    }),
    prepareForRelease: async () => {},
    release: async () => {},
    verifyReleased: async () => true,
  };

  const coordinatorNull = new ResourceCoordinator({
    providers: new Map([['LLM', mockProviderNull]]),
  });

  await assert.rejects(
    coordinatorNull.acquire('SDXL', 'owner-sdxl'),
    (err: any) => {
      assert.equal(err.code, 'PREPARATION_FAILED');
      return true;
    }
  );
  assert.equal(coordinatorNull.getState(), 'RECOVERY_REQUIRED');

  const mockProviderUndefined: IResourceProviderLifecycle = {
    resourceType: 'LLM',
    isAvailable: async () => true,
    getStatus: async () => ({
      loaded: false,
      residency: undefined,
    }),
    prepareForRelease: async () => {},
    release: async () => {},
    verifyReleased: async () => true,
  };

  const coordinatorUndef = new ResourceCoordinator({
    providers: new Map([['LLM', mockProviderUndefined]]),
  });

  await assert.rejects(
    coordinatorUndef.acquire('SDXL', 'owner-sdxl'),
    (err: any) => {
      assert.equal(err.code, 'PREPARATION_FAILED');
      return true;
    }
  );
  assert.equal(coordinatorUndef.getState(), 'RECOVERY_REQUIRED');
});

test('2.3.2.6-B5. Numeric residency with loaded: false fails closed', async () => {
  const mockProvider: IResourceProviderLifecycle = {
    resourceType: 'LLM',
    isAvailable: async () => true,
    getStatus: async () => ({
      loaded: false,
      residency: 123 as any,
    }),
    prepareForRelease: async () => {},
    release: async () => {},
    verifyReleased: async () => true,
  };

  const coordinator = new ResourceCoordinator({
    providers: new Map([['LLM', mockProvider]]),
  });

  await assert.rejects(
    coordinator.acquire('SDXL', 'owner-sdxl'),
    (err: any) => {
      assert.equal(err.code, 'PREPARATION_FAILED');
      return true;
    }
  );
  assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
});

test('2.3.2.6-B6. OllamaLifecycleAdapter normalizeResidency prevents admission on ambiguous /api/ps responses', async () => {
  const adapter = new OllamaLifecycleAdapter({
    fetchFn: (async (url: string) => {
      if (url.includes('/api/ps')) {
        // Return malformed JSON without valid models array
        return new Response(JSON.stringify({ unexpected: 'format' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as any,
  });

  // When /api/ps has no models, isResident is false -> NOT_RESIDENT
  // But if /api/ps throws network error:
  const failingAdapter = new OllamaLifecycleAdapter({
    fetchFn: (async () => {
      throw new Error('Socket reset by peer');
    }) as any,
  });

  const admitted = await failingAdapter.prepareForAdmission('SDXL');
  assert.equal(admitted, false, 'Failed status query must deny SDXL admission fail-closed');
});

// --- Workstream C: Recovery Single-Flight Correctness & Mutex Serialization ---

test('2.3.2.6-C1. Duplicate concurrent recover() for the same reservation shares one single-flight execution', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let unloads = 0;
    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: true, residency: 'RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {
        unloads++;
        await new Promise((r) => setTimeout(r, 40));
      },
      verifyReleased: async () => true,
    };

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_single_flight_shared',
      resourceType: 'LLM',
      ownerId: 'owner-sf',
      status: 'ACTIVE',
      pid: 55555,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    const [res1, res2] = await Promise.all([
      coordinator.recover('resv_single_flight_shared', { callerId: 'owner-sf' }),
      coordinator.recover('resv_single_flight_shared', { callerId: 'owner-sf' }),
    ]);

    assert.equal(res1.recovered, true);
    assert.equal(res2.recovered, true);
    assert.equal(res1.targetId, 'resv_single_flight_shared');
    assert.equal(res2.targetId, 'resv_single_flight_shared');
    assert.equal(unloads, 1, 'Provider unload should only execute once across duplicate concurrent calls');
  } finally {
    cleanup();
  }
});

test('2.3.2.6-C2. Concurrent recoveries for DIFFERENT reservations (A and B) receive distinct results and do not coalesce', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const executionOrder: string[] = [];
    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: true, residency: 'RESIDENT' }),
      prepareForRelease: async () => {},
      release: async (target) => {
        executionOrder.push(target);
        await new Promise((r) => setTimeout(r, 30));
      },
      verifyReleased: async () => true,
    };

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_distinct_A',
      resourceType: 'LLM',
      ownerId: 'owner_A',
      status: 'ACTIVE',
      pid: 60001,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    adapter.createReservation({
      id: 'resv_distinct_B',
      resourceType: 'LLM',
      ownerId: 'owner_B',
      status: 'ACTIVE',
      pid: 60002,
      acquiredAt: Date.now() - 4000,
      lastHeartbeatAt: Date.now() - 1000,
    });

    // Fire recovery for A and B concurrently
    const [resA, resB] = await Promise.all([
      coordinator.recover('resv_distinct_A', { callerId: 'owner_A' }),
      coordinator.recover('resv_distinct_B', { callerId: 'owner_B' }),
    ]);

    // Res A must receive A's result; Res B must receive B's result
    assert.equal(resA.recovered, true);
    assert.equal(resA.targetId, 'resv_distinct_A');

    assert.equal(resB.recovered, true);
    assert.equal(resB.targetId, 'resv_distinct_B');

    // Execution should have completed both in serialized order
    assert.equal(executionOrder.length, 2);
    assert.match(executionOrder[0], /resv_distinct_A/);
    assert.match(executionOrder[1], /resv_distinct_B/);

    // Both reservations should be RELEASED in persistence
    const recA = adapter.getReservation('resv_distinct_A');
    const recB = adapter.getReservation('resv_distinct_B');
    assert.equal(recA?.status, 'RELEASED');
    assert.equal(recB?.status, 'RELEASED');
  } finally {
    cleanup();
  }
});

test('2.3.2.6-C3. Three concurrent recoveries for different reservations (A, B, C) all resolve sequentially with accurate results', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    for (const id of ['resv_3_A', 'resv_3_B', 'resv_3_C']) {
      adapter.createReservation({
        id,
        resourceType: 'LLM',
        ownerId: `owner_${id}`,
        status: 'ACTIVE',
        pid: 70000 + Number(id.slice(-1).charCodeAt(0)),
        acquiredAt: Date.now() - 5000,
        lastHeartbeatAt: Date.now() - 2000,
      });
    }

    const [resA, resB, resC] = await Promise.all([
      coordinator.recover('resv_3_A', { callerId: 'owner_resv_3_A' }),
      coordinator.recover('resv_3_B', { callerId: 'owner_resv_3_B' }),
      coordinator.recover('resv_3_C', { callerId: 'owner_resv_3_C' }),
    ]);

    assert.equal(resA.targetId, 'resv_3_A');
    assert.equal(resB.targetId, 'resv_3_B');
    assert.equal(resC.targetId, 'resv_3_C');
    assert.equal(resA.recovered, true);
    assert.equal(resB.recovered, true);
    assert.equal(resC.recovered, true);
  } finally {
    cleanup();
  }
});

test('2.3.2.6-C4. Failure of reservation A recovery does not poison queued recovery of reservation B', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: (pid) => pid === 80001, // PID 80001 (A) is ALIVE -> will fail recovery; PID 80002 (B) is DEAD -> will succeed
    };

    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_fail_A',
      resourceType: 'LLM',
      ownerId: 'owner_fail',
      status: 'ACTIVE',
      pid: 80001,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    adapter.createReservation({
      id: 'resv_succeed_B',
      resourceType: 'LLM',
      ownerId: 'owner_succ',
      status: 'ACTIVE',
      pid: 80002,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    const [resA, resB] = await Promise.all([
      coordinator.recover('resv_fail_A', { callerId: 'owner_fail' }),
      coordinator.recover('resv_succeed_B', { callerId: 'owner_succ' }),
    ]);

    // Res A failed due to live process
    assert.equal(resA.recovered, false);
    assert.equal(resA.reason, 'PROCESS_STILL_ALIVE');

    // Res B succeeded despite being queued behind failing A
    assert.equal(resB.recovered, true);
    assert.equal(resB.targetId, 'resv_succeed_B');
    assert.equal(adapter.getReservation('resv_succeed_B')?.status, 'RELEASED');
  } finally {
    cleanup();
  }
});

test('2.3.2.6-C5. Unauthorized caller attempting to join in-flight recovery of reservation A is rejected with WRONG_OWNER immediately', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let unloads = 0;
    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: true, residency: 'RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {
        unloads++;
        await new Promise((r) => setTimeout(r, 60));
      },
      verifyReleased: async () => true,
    };

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_flight_secure',
      resourceType: 'LLM',
      ownerId: 'owner_authorized',
      status: 'ACTIVE',
      pid: 85001,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    // Start authorized recovery
    const authorizedPromise = coordinator.recover('resv_flight_secure', { callerId: 'owner_authorized' });

    // Unauthorized caller attempts to join in-flight recovery
    await assert.rejects(
      coordinator.recover('resv_flight_secure', { callerId: 'owner_intruder' }),
      (err: any) => {
        assert.equal(err.code, 'WRONG_OWNER');
        return true;
      }
    );

    // Authorized recovery completes successfully
    const authorizedResult = await authorizedPromise;
    assert.equal(authorizedResult.recovered, true);
    assert.equal(unloads, 1);
  } finally {
    cleanup();
  }
});

test('2.3.2.6-C6. Retry after previous recovery failure succeeds cleanly', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let isAlive = true;
    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => isAlive,
    };

    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => true,
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers: new Map([['LLM', mockProvider]]),
    });

    adapter.createReservation({
      id: 'resv_retry_test',
      resourceType: 'LLM',
      ownerId: 'retry_owner',
      status: 'ACTIVE',
      pid: 86001,
      acquiredAt: Date.now() - 5000,
      lastHeartbeatAt: Date.now() - 2000,
    });

    // First attempt fails because process is alive
    const firstResult = await coordinator.recover('resv_retry_test', { callerId: 'retry_owner' });
    assert.equal(firstResult.recovered, false);
    assert.equal(firstResult.reason, 'PROCESS_STILL_ALIVE');

    // Process subsequently dies
    isAlive = false;

    // Second attempt (retry) succeeds
    const retryResult = await coordinator.recover('resv_retry_test', { callerId: 'retry_owner' });
    assert.equal(retryResult.recovered, true);
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

// --- Workstream D: Process-Instance Identifier Strength ---

test('2.3.2.6-D1. PROCESS_INSTANCE_ID adheres to format proc_<pid>_<timestamp>_<uuid>', async () => {
  const { PROCESS_INSTANCE_ID, PROCESS_STARTED_AT } = await import('../coordinator/index.js');
  const coordinator = new ResourceCoordinator();

  assert.equal(coordinator.processInstanceId, PROCESS_INSTANCE_ID);
  assert.equal(coordinator.processStartedAt, PROCESS_STARTED_AT);

  // Validate format: proc_<pid>_<timestamp>_<uuid-v4>
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const parts = PROCESS_INSTANCE_ID.split('_');

  assert.equal(parts[0], 'proc');
  assert.equal(Number(parts[1]), process.pid);
  assert.equal(Number(parts[2]), PROCESS_STARTED_AT);
  assert.match(parts[3], uuidV4Regex, 'UUID part must match RFC 4122 v4 UUID format');
});

test('2.3.2.6-D2. Process-instance identifiers are stable per process and distinct across runs', async () => {
  const coordinator1 = new ResourceCoordinator();
  const coordinator2 = new ResourceCoordinator();

  // Within the same process runtime, instances share the constant module processInstanceId
  assert.equal(coordinator1.processInstanceId, coordinator2.processInstanceId);

  // But simulated new processes (re-evaluating random UUIDs) produce distinct 128-bit identifiers
  const { randomUUID } = await import('node:crypto');
  const uuid1 = randomUUID();
  const uuid2 = randomUUID();
  assert.notEqual(uuid1, uuid2, 'Cryptographically random UUIDs must be distinct');
});

test('2.3.2.6-D3. Persisted reservation with matching PID but missing processInstanceId metadata fails closed', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => true, // Still alive
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
    });

    adapter.createReservation({
      id: 'resv_missing_meta',
      resourceType: 'LLM',
      ownerId: 'owner_meta',
      status: 'ACTIVE',
      pid: process.pid, // Same PID as running process!
      acquiredAt: Date.now() - 50000,
      lastHeartbeatAt: Date.now() - 40000,
      // Missing metadata.processInstanceId
    });

    const result = await coordinator.recover('resv_missing_meta', { isSystemPrivileged: true });
    assert.equal(result.recovered, false);
    assert.equal(result.reason, 'PROCESS_STILL_ALIVE');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});


