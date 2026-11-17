/**
 * Phase 2.3.2: Ollama Runtime Lifecycle Integration & Request Coordination Tests
 * 
 * Deterministic test suite covering all 32 required scenarios:
 * - Category 1: Admission & Serialization (Tests 1-6)
 * - Category 2: Completion & Error Policies (Tests 7-11)
 * - Category 3: Timeout & Cancellation Safety (Tests 12-16)
 * - Category 4: Model Unload Lifecycle (Tests 17-21)
 * - Category 5: Fail-Closed Recovery (Tests 22-27)
 * - Category 6: Metadata & Tenant Security (Tests 28-32)
 * - Optional Opt-In: Live Ollama Integration (opt-in only)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ResourceCoordinator,
  SQLitePersistenceAdapter,
  OllamaLifecycleAdapter,
  ResourceCoordinatorError,
  type ProcessLivenessChecker,
  type ProcessLivenessStatus,
  type IResourceProviderLifecycle,
  type ReservationRecord,
  type ResourceType,
} from '../coordinator/index.js';
import {
  OllamaLLMProvider,
  FallbackLLMProvider,
  LocalLLMProvider,
  createDefaultLLMProvider,
  SanitizedLLMError,
} from '../providers/llm.js';
import { RAGEngine } from '../providers/rag_engine.js';
import { openDb } from '../db.js';
import type { BrandContext, CharacterContext } from '../providers/types.js';

const mockBrand: BrandContext = {
  id: 42,
  name: 'Auravo Test Studio',
  handle: '@auravo.test',
  niche: 'Classical Performing Arts',
  tone: 'regal, mysterious',
  visualStyle: 'Dramatic theater spotlight, 9:16 vertical',
  preferredTopics: ['Kathak pirouettes', 'Lotus mudra'],
  prohibitedTopics: ['nudity'],
};

const mockCharacter: CharacterContext = {
  id: 99,
  name: 'Ananya',
  appearance: 'Expressive almond eyes, alta on palms',
  clothingStyle: 'Emerald silk angrakha',
  personality: 'Regal and intense',
  voiceStyle: 'Calm, low register',
};

const validStoryResponse = {
  message: {
    content: JSON.stringify({
      title: 'The Silent Overture',
      hook: 'When the spotlight cuts the darkness, time stands still.',
      premise: 'A solo dancer uncovers a lost choreography pattern.',
      targetDurationSec: 45,
      language: 'English',
      tone: 'dramatic',
      endingType: 'Rewatch Hook',
      scenes: [
        {
          sceneOrder: 1,
          durationSec: 8,
          narration: 'When the spotlight cuts the darkness, time stands still.',
          visualPrompt: 'Center stage silhouette in emerald silk under warm spotlight.',
          voiceDirection: 'Calm and magnetic',
        },
        {
          sceneOrder: 2,
          durationSec: 10,
          narration: 'Every step traces an ancient geometry.',
          visualPrompt: 'Close up of hands forming Alapadma lotus gesture.',
          voiceDirection: 'Building intensity',
        },
      ],
    }),
  },
};

const validIdeasResponse = {
  message: {
    content: JSON.stringify({
      ideas: [
        {
          title: 'Echoes of the Stage',
          premise: 'A mystery dancer improvises under neon theatrical lighting.',
          category: 'Stage Performance',
          potentialScore: 92,
          originalityScore: 88,
          visualPotentialScore: 95,
          difficulty: 'MEDIUM',
          audienceFit: 'Fans of classical arts',
          tags: ['dance', 'mystery'],
        },
      ],
    }),
  },
};

function createTestPersistence(): { adapter: SQLitePersistenceAdapter; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auravo-llm-lifecycle-'));
  const dbFile = path.join(tmpDir, 'test_coordinator.db');
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
// Category 1: Admission & Serialization (Tests 1–6)
// ============================================================================

test('1. LLM inference acquires an LLM reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    let fetchCalled = false;
    let reservationActiveDuringFetch = false;

    const mockFetch: typeof fetch = async (url) => {
      fetchCalled = true;
      const snap = coordinator.getSnapshot();
      reservationActiveDuringFetch = snap.activeReservation !== null && snap.activeReservation.resourceType === 'LLM';
      return new Response(JSON.stringify(validStoryResponse));
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    const story = await provider.generateStory(mockBrand, 'Test Topic');
    assert.ok(fetchCalled, 'fetch must be called');
    assert.ok(reservationActiveDuringFetch, 'Reservation must be actively held during inference');
    assert.ok(story.metadata?.reservationId, 'Result metadata must contain reservation ID');
    assert.equal(coordinator.getState(), 'IDLE', 'Coordinator must return to IDLE after completion');
  } finally {
    cleanup();
  }
});

test('2. Two concurrent LLM requests serialize', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    let concurrentCount = 0;
    let maxConcurrency = 0;

    const mockFetch: typeof fetch = async () => {
      concurrentCount++;
      maxConcurrency = Math.max(maxConcurrency, concurrentCount);
      await new Promise((r) => setTimeout(r, 40));
      concurrentCount--;
      return new Response(JSON.stringify(validStoryResponse));
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    const [story1, story2] = await Promise.all([
      provider.generateStory(mockBrand, 'Topic 1'),
      provider.generateStory(mockBrand, 'Topic 2'),
    ]);

    assert.equal(maxConcurrency, 1, 'Maximum LLM concurrency must be exactly 1 (strict serialization)');
    assert.notEqual(story1.metadata?.reservationId, story2.metadata?.reservationId, 'Each request has unique reservation ID');
  } finally {
    cleanup();
  }
});

test('3. FIFO ordering is preserved across queued requests', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const executionOrder: string[] = [];

    const mockFetch: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const prompt = body?.messages?.[1]?.content || '';
      const idMatch = prompt.match(/Topic (\d)/);
      const id = idMatch ? idMatch[1] : 'unknown';
      executionOrder.push(id);
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify(validStoryResponse));
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    await Promise.all([
      provider.generateStory(mockBrand, 'Topic 1'),
      provider.generateStory(mockBrand, 'Topic 2'),
      provider.generateStory(mockBrand, 'Topic 3'),
    ]);

    assert.deepEqual(executionOrder, ['1', '2', '3'], 'FIFO queue order must be strictly preserved');
  } finally {
    cleanup();
  }
});

test('4. SDXL admission is blocked during active LLM inference', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    let sdxlAttemptedDuringLLM = false;

    const mockFetch: typeof fetch = async () => {
      // While LLM is active, attempt to acquire SDXL
      const snap = coordinator.getSnapshot();
      assert.equal(snap.activeReservation?.resourceType, 'LLM');

      // SDXL request should be queued and not immediately granted
      let sdxlGrantedImmediately = false;
      const sdxlPromise = coordinator.acquire('SDXL', 'job:sdxl-1', { timeoutMs: 50 }).then(async (resv) => {
        sdxlGrantedImmediately = true;
        await resv.release();
      }).catch(() => {});

      await new Promise((r) => setTimeout(r, 20));
      sdxlAttemptedDuringLLM = !sdxlGrantedImmediately;
      return new Response(JSON.stringify(validStoryResponse));
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    await provider.generateStory(mockBrand, 'Test Topic');
    assert.ok(sdxlAttemptedDuringLLM, 'SDXL admission must be blocked/queued while LLM inference is active');
  } finally {
    cleanup();
  }
});

test('5. LLM admission is blocked during active SDXL reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });

    // Manually hold active SDXL reservation
    const sdxlResv = await coordinator.acquire('SDXL', 'job:sdxl-active');
    assert.equal(coordinator.getState(), 'ACTIVE');

    let llmExecuted = false;
    const mockFetch: typeof fetch = async () => {
      llmExecuted = true;
      return new Response(JSON.stringify(validStoryResponse));
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
      timeoutMs: 50,
      admissionTimeoutMs: 50,
    });

    // LLM request should time out waiting for admission while SDXL is held
    await assert.rejects(
      async () => {
        await provider.generateStory(mockBrand, 'Test Topic');
      },
      (err: any) => err instanceof ResourceCoordinatorError && err.code === 'TIMEOUT'
    );

    assert.equal(llmExecuted, false, 'LLM inference must not execute while SDXL is holding active admission');
    await sdxlResv.release();
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

test('6. A failed acquisition does not start inference', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    // Force coordinator into RECOVERY_REQUIRED state
    coordinator.markRecoveryRequired('resv_stale', 'Simulated failure lock');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

    let fetchCalled = false;
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify(validStoryResponse));
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    await assert.rejects(
      async () => {
        await provider.generateStory(mockBrand, 'Test Topic');
      },
      (err: any) => err instanceof ResourceCoordinatorError && err.code === 'RECOVERY_REQUIRED'
    );

    assert.equal(fetchCalled, false, 'Inference must never be started if coordinator acquisition fails');
  } finally {
    cleanup();
  }
});

// ============================================================================
// Category 2: Completion & Error Policies (Tests 7–11)
// ============================================================================

test('7. Successful inference releases the reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const mockFetch: typeof fetch = async () => new Response(JSON.stringify(validStoryResponse));

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    const story = await provider.generateStory(mockBrand, 'Test Topic');
    assert.ok(story.title);
    assert.equal(coordinator.getState(), 'IDLE');
    assert.equal(coordinator.getActiveReservation(), null);
    assert.equal(adapterInstance.getActiveRequestCount(), 0);
  } finally {
    cleanup();
  }
});

test('8. Invalid response follows existing fallback policy and releases reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    // Returns malformed non-JSON output
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ message: { content: 'Not valid JSON output' } }));

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const ollamaProvider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    const fallbackProvider = new FallbackLLMProvider(ollamaProvider, new LocalLLMProvider());
    const story = await fallbackProvider.generateStory(mockBrand, 'Test Topic');

    assert.ok(story.title);
    assert.equal(story.metadata?.provider, 'deterministic');
    assert.equal(story.metadata?.fallbackOccurred, true);
    assert.equal(story.metadata?.fallbackReason, 'LLM_INVALID_RESPONSE');
    assert.equal(coordinator.getState(), 'IDLE', 'Reservation must be cleanly released on verified response');
  } finally {
    cleanup();
  }
});

test('9. Provider HTTP 500 failure follows existing fallback policy and releases reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const mockFetch: typeof fetch = async () =>
      new Response('Internal Server Error', { status: 500 });

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const ollamaProvider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    const fallbackProvider = new FallbackLLMProvider(ollamaProvider, new LocalLLMProvider());
    const story = await fallbackProvider.generateStory(mockBrand, 'Test Topic');

    assert.ok(story.title);
    assert.equal(story.metadata?.provider, 'deterministic');
    assert.equal(story.metadata?.fallbackOccurred, true);
    assert.equal(story.metadata?.fallbackReason, 'LLM_INVALID_RESPONSE');
    assert.equal(coordinator.getState(), 'IDLE', 'Reservation must be cleanly released when server completed response');
  } finally {
    cleanup();
  }
});

test('10. Double release does not corrupt state', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const resv = await coordinator.acquire('LLM', 'user:42');
    const firstRel = await resv.release();
    assert.equal(firstRel.success, true);
    assert.equal(firstRel.alreadyReleased, false);

    const secondRel = await resv.release();
    assert.equal(secondRel.success, true);
    assert.equal(secondRel.alreadyReleased, true);
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

test('11. Wrong-owner release is rejected', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const resv = await coordinator.acquire('LLM', 'user:42');

    await assert.rejects(
      async () => {
        await coordinator.release(resv.id, 'user:attacker');
      },
      (err: any) => err instanceof ResourceCoordinatorError && err.code === 'WRONG_OWNER'
    );

    assert.equal(coordinator.getState(), 'ACTIVE', 'Active reservation remains protected');
    await resv.release();
  } finally {
    cleanup();
  }
});

// ============================================================================
// Category 3: Timeout & Cancellation Safety (Tests 12–16)
// ============================================================================

test('12. Client timeout does not automatically release an unresolved reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    let hangingFetchStarted = false;

    const hangingFetch: typeof fetch = async (url, init) => {
      hangingFetchStarted = true;
      return new Promise((_, reject) => {
        const timer = setTimeout(() => {
          const timeoutErr = new Error('Inference request timed out');
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        }, 50);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const timeoutErr = new Error('Inference request timed out');
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        });
      });
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: hangingFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: hangingFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
      timeoutMs: 30,
    });

    await assert.rejects(
      async () => {
        await provider.generateStory(mockBrand, 'Hanging Topic');
      },
      (err: any) => err instanceof SanitizedLLMError && err.code === 'LLM_TIMEOUT'
    );

    assert.ok(hangingFetchStarted);
    // CRITICAL: Unresolved timeout MUST NOT release reservation!
    assert.notEqual(coordinator.getState(), 'IDLE', 'Coordinator must NOT return to IDLE after timeout');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED', 'Coordinator must enter RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('13. Client abort does not automatically imply daemon cancellation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });

    const mockFetch: typeof fetch = async (url, init) => {
      return new Promise((_, reject) => {
        const timer = setTimeout(() => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        }, 50);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
      timeoutMs: 30,
    });

    await assert.rejects(
      async () => {
        await provider.generateStory(mockBrand, 'Aborted Topic');
      },
      (err: any) => err instanceof SanitizedLLMError && err.code === 'LLM_TIMEOUT'
    );

    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED', 'Client abort must lock coordinator fail-closed');
  } finally {
    cleanup();
  }
});

test('14. Uncertain request termination enters recovery-required state', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const failingFetch: typeof fetch = async () => {
      throw new Error('Socket hang up mid-stream');
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: failingFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: failingFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    await assert.rejects(async () => {
      await provider.generateStory(mockBrand, 'Hangup Topic');
    });

    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED', 'Mid-stream socket error leaves uncertain state -> RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('15. New conflicting admission remains blocked while in recovery-required state', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    coordinator.markRecoveryRequired('resv_timeout_1', 'Inference timeout lock');

    // Conflicting resource (SDXL) must be blocked immediately
    await assert.rejects(
      async () => {
        await coordinator.acquire('SDXL', 'job:sdxl-blocked');
      },
      (err: any) => err instanceof ResourceCoordinatorError && err.code === 'RECOVERY_REQUIRED'
    );

    // Another LLM request must also be blocked immediately
    await assert.rejects(
      async () => {
        await coordinator.acquire('LLM', 'user:new');
      },
      (err: any) => err instanceof ResourceCoordinatorError && err.code === 'RECOVERY_REQUIRED'
    );
  } finally {
    cleanup();
  }
});

test('16. Verified completion allows safe release', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const mockFetch: typeof fetch = async () => new Response(JSON.stringify(validIdeasResponse));

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    const ideas = await provider.generateIdeas(mockBrand, 1);
    assert.equal(ideas.length, 1);
    assert.equal(ideas[0].metadata?.reservationId !== undefined, true);
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

// ============================================================================
// Category 4: Model Unload Lifecycle (Tests 17–21)
// ============================================================================

test('17. Model unload waits for active inference to drain', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    let inferenceActive = true;

    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/generate')) {
        // Model unload request
        assert.equal(inferenceActive, false, 'Model unload must only occur after active inference has finished');
        return new Response('{"status":"success"}');
      }
      if (u.includes('/api/ps')) {
        return new Response('{"models":[]}');
      }
      return new Response(JSON.stringify(validStoryResponse));
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });

    // Manually register an active in-flight request
    adapterInstance.startRequest('req_inflight', 'user:1');

    // Asynchronously finish inference after 30ms
    setTimeout(() => {
      inferenceActive = false;
      adapterInstance.completeRequest('req_inflight');
    }, 30);

    const observation = await adapterInstance.coordinatedUnload(coordinator, 'system:unload', { maxDrainWaitMs: 1000 });
    assert.equal(observation.status, 'VERIFIED_UNLOADED');
    assert.equal(observation.inferenceRequestsDrained, true);
  } finally {
    cleanup();
  }
});

test('18. New requests are blocked during unload', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    let unloadHolding = true;

    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/generate')) {
        await new Promise((r) => setTimeout(r, 40));
        return new Response('{"status":"success"}');
      }
      if (u.includes('/api/ps')) {
        return new Response('{"models":[]}');
      }
      return new Response(JSON.stringify(validStoryResponse));
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });

    // Start coordinated unload
    const unloadPromise = adapterInstance.coordinatedUnload(coordinator, 'system:unload');

    // Concurrently try to acquire LLM
    let llmBlocked = false;
    const acquirePromise = coordinator.acquire('LLM', 'user:during-unload', { timeoutMs: 20 })
      .catch((err) => {
        llmBlocked = true;
      });

    await Promise.all([unloadPromise, acquirePromise]);
    assert.ok(llmBlocked, 'Incoming requests must be blocked/timeout while unload reservation is held');
  } finally {
    cleanup();
  }
});

test('19. /api/ps residency verification is recorded accurately', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/generate')) return new Response('{"status":"success"}');
      if (u.includes('/api/ps')) {
        // Return empty models array
        return new Response(JSON.stringify({ models: [] }));
      }
      return new Response('{}');
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch, model: 'qwen2.5:1.5b' });
    const observation = await adapterInstance.coordinatedUnload(coordinator);

    assert.equal(observation.psReportedNotResident, true);
    assert.equal(observation.metalMemoryDeallocationProven, false, 'Must explicitly record that Metal memory deallocation is not proven by /api/ps');
    assert.equal(observation.systemMemoryPressureRecoveredProven, false, 'Must explicitly record that system memory pressure recovery is not proven by /api/ps');
    assert.equal(observation.status, 'VERIFIED_UNLOADED');
  } finally {
    cleanup();
  }
});

test('20. Failed unload verification prevents conflicting resource admission', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/generate')) return new Response('{"status":"success"}');
      if (u.includes('/api/ps')) {
        // Model is STILL listed in /api/ps!
        return new Response(JSON.stringify({ models: [{ name: 'qwen2.5:1.5b' }] }));
      }
      return new Response('{}');
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch, model: 'qwen2.5:1.5b' });
    const observation = await adapterInstance.coordinatedUnload(coordinator);

    assert.equal(observation.status, 'FAILED_STILL_RESIDENT');
    assert.equal(observation.psReportedNotResident, false);
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED', 'Failed unload verification must enter RECOVERY_REQUIRED');

    // Conflicting resource (SDXL) must now be blocked
    await assert.rejects(
      async () => {
        await coordinator.acquire('SDXL', 'job:sdxl-conflicting');
      },
      (err: any) => err instanceof ResourceCoordinatorError && err.code === 'RECOVERY_REQUIRED'
    );
  } finally {
    cleanup();
  }
});

test('21. Successful unload verification allows lifecycle completion', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    let unloadCalled = false;

    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/generate')) {
        unloadCalled = true;
        return new Response('{"status":"success"}');
      }
      if (u.includes('/api/ps')) {
        return new Response(JSON.stringify({ models: [] }));
      }
      return new Response('{}');
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const observation = await adapterInstance.coordinatedUnload(coordinator);

    assert.ok(unloadCalled);
    assert.equal(observation.status, 'VERIFIED_UNLOADED');
    assert.equal(coordinator.getState(), 'IDLE');

    // Next resource can now acquire cleanly!
    const nextResv = await coordinator.acquire('SDXL', 'job:sdxl-next');
    assert.equal(coordinator.getState(), 'ACTIVE');
    await nextResv.release();
  } finally {
    cleanup();
  }
});

// ============================================================================
// Category 5: Fail-Closed Recovery (Tests 22–27)
// ============================================================================

test('22. Restart with stale reservation and dead process reclaims safely', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    // 1. Manually insert unresolved stale reservation with dead PID
    const deadPid = 99999999;
    const staleRecord: ReservationRecord = {
      id: 'resv_stale_dead',
      resourceType: 'LLM',
      ownerId: 'user:historical',
      status: 'ACTIVE',
      pid: deadPid,
      acquiredAt: Date.now() - 60000,
      lastHeartbeatAt: Date.now() - 50000,
    };
    adapter.createReservation(staleRecord);

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false, // Dead process
    };

    const mockProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => true,
      getStatus: async () => ({ loaded: false, residency: 'NOT_RESIDENT' }),
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
    const result = await coordinator.recover('resv_stale_dead', { isSystemPrivileged: true });
    assert.equal(result.recovered, true);
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

test('23. Restart with live process fails closed', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const livePid = 12345;
    const record: ReservationRecord = {
      id: 'resv_live_proc',
      resourceType: 'LLM',
      ownerId: 'user:running',
      status: 'ACTIVE',
      pid: livePid,
      acquiredAt: Date.now() - 10000,
      lastHeartbeatAt: Date.now() - 5000,
    };
    adapter.createReservation(record);

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: (pid) => (pid === livePid ? true : false),
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
    });

    const result = await coordinator.recover('resv_live_proc', { isSystemPrivileged: true });
    assert.equal(result.recovered, false);
    assert.equal(result.reason, 'PROCESS_STILL_ALIVE');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED', 'Live process must keep coordinator locked');
  } finally {
    cleanup();
  }
});

test('24. Restart with unknown process state fails closed', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const unknownPid = 54321;
    const record: ReservationRecord = {
      id: 'resv_unknown_proc',
      resourceType: 'LLM',
      ownerId: 'user:unknown',
      status: 'ACTIVE',
      pid: unknownPid,
      acquiredAt: Date.now() - 10000,
      lastHeartbeatAt: Date.now() - 5000,
    };
    adapter.createReservation(record);

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => 'UNKNOWN',
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
    });

    const result = await coordinator.recover('resv_unknown_proc', { isSystemPrivileged: true });
    assert.equal(result.recovered, false);
    assert.equal(result.reason, 'UNVERIFIED_PROCESS_STATE');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('25. Expired TTL with live process is NOT reclaimed', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const livePid = 11111;
    // Ancient reservation (1 hour old)
    const ancientRecord: ReservationRecord = {
      id: 'resv_ancient_live',
      resourceType: 'LLM',
      ownerId: 'user:ancient',
      status: 'ACTIVE',
      pid: livePid,
      acquiredAt: Date.now() - 3600000,
      lastHeartbeatAt: Date.now() - 3500000,
    };
    adapter.createReservation(ancientRecord);

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => true, // Still alive despite ancient TTL!
    };

    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
    });

    const result = await coordinator.recover('resv_ancient_live', { isSystemPrivileged: true });
    assert.equal(result.recovered, false);
    assert.equal(result.reason, 'PROCESS_STILL_ALIVE');
  } finally {
    cleanup();
  }
});

test('26. Expired TTL with unknown provider state is NOT reclaimed', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const deadPid = 99999;
    const record: ReservationRecord = {
      id: 'resv_ancient_unknown_provider',
      resourceType: 'LLM',
      ownerId: 'user:ancient',
      status: 'ACTIVE',
      pid: deadPid,
      acquiredAt: Date.now() - 3600000,
      lastHeartbeatAt: Date.now() - 3500000,
    };
    adapter.createReservation(record);

    const mockLiveness: ProcessLivenessChecker = {
      isProcessAlive: () => false, // Dead process
    };

    const failingProvider: IResourceProviderLifecycle = {
      resourceType: 'LLM',
      isAvailable: async () => false,
      getStatus: async () => {
        throw new Error('Ollama daemon unreachable');
      },
      prepareForRelease: async () => {},
      release: async () => {},
      verifyReleased: async () => false,
    };

    const providers = new Map<ResourceType, IResourceProviderLifecycle>([['LLM', failingProvider]]);
    const coordinator = new ResourceCoordinator({
      persistence: adapter,
      processLiveness: mockLiveness,
      providers,
    });

    const result = await coordinator.recover('resv_ancient_unknown_provider', { isSystemPrivileged: true });
    assert.equal(result.recovered, false);
    assert.equal(result.reason, 'PROVIDER_QUERY_FAILED');
  } finally {
    cleanup();
  }
});

test('27. No TTL-only resource reclamation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    // Missing PID record
    const record: ReservationRecord = {
      id: 'resv_no_pid',
      resourceType: 'LLM',
      ownerId: 'user:no_pid',
      status: 'ACTIVE',
      acquiredAt: Date.now() - 86400000, // 24 hours ago
      lastHeartbeatAt: Date.now() - 86400000,
    };
    adapter.createReservation(record);

    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const result = await coordinator.recover('resv_no_pid', { isSystemPrivileged: true });

    // Missing PID without verification cannot be safely assumed dead
    assert.equal(result.recovered, false);
    assert.equal(result.reason, 'UNVERIFIED_PROCESS_STATE');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

// ============================================================================
// Category 6: Metadata & Tenant Security (Tests 28–32)
// ============================================================================

test('28. Concurrent requests do not contaminate metadata', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });

    const mockFetch: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const prompt = body?.messages?.[1]?.content || '';
      const topic = prompt.includes('Topic A') ? 'Topic A' : 'Topic B';
      await new Promise((r) => setTimeout(r, 20));
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              title: `Story for ${topic}`,
              hook: `Hook for ${topic}`,
              premise: `Premise for ${topic}`,
              targetDurationSec: 45,
              language: 'English',
              tone: 'dramatic',
              endingType: 'Rewatch Hook',
              scenes: [
                {
                  sceneOrder: 1,
                  durationSec: 8,
                  narration: `Scene for ${topic}`,
                  visualPrompt: 'Prompt',
                  voiceDirection: 'Direction',
                },
              ],
            }),
          },
        })
      );
    };

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    const [storyA, storyB] = await Promise.all([
      provider.generateStory(mockBrand, 'Topic A'),
      provider.generateStory(mockBrand, 'Topic B'),
    ]);

    assert.equal(storyA.title, 'Story for Topic A');
    assert.equal(storyB.title, 'Story for Topic B');
    assert.notEqual(storyA.metadata?.reservationId, storyB.metadata?.reservationId);
    assert.equal(storyA.metadata?.provider, 'ollama');
    assert.equal(storyB.metadata?.provider, 'ollama');
  } finally {
    cleanup();
  }
});

test('29. Fallback metadata accurately identifies the deterministic provider and reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const mockFetch: typeof fetch = async () => new Response('Ollama internal error', { status: 500 });

    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const ollamaProvider = new OllamaLLMProvider(undefined, {
      fetchFn: mockFetch,
      coordinator,
      lifecycleAdapter: adapterInstance,
    });

    const fallbackProvider = new FallbackLLMProvider(ollamaProvider, new LocalLLMProvider());
    const story = await fallbackProvider.generateStory(mockBrand, 'Fallback Topic');

    assert.equal(story.metadata?.provider, 'deterministic');
    assert.equal(story.metadata?.fallbackOccurred, true);
    assert.equal(story.metadata?.fallbackReason, 'LLM_INVALID_RESPONSE');
    assert.ok(story.metadata?.reservationId?.startsWith('resv_'), 'Fallback metadata includes the reservationId');
  } finally {
    cleanup();
  }
});

test('30. Authenticated user identity reaches RAG through backend-controlled flow', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auravo-rag-sec-'));
  const dbFile = path.join(tmpDir, 'test_rag.db');
  const db = openDb(dbFile);
  try {
    const ragEngine = new RAGEngine(db);
    db.prepare('INSERT OR IGNORE INTO users(id, email, passwordHash) VALUES(1, ?, ?)').run('user1@example.com', 'hash1');
    // User 1 creates private knowledge
    ragEngine.addKnowledge({
      category: 'CHOREOGRAPHY',
      title: 'Secret User 1 Mudra',
      content: 'Private user 1 choreography data',
      tags: ['secret'],
    }, 1);

    let queriedUserId: number | undefined;
    const mockRAGEngine = {
      search: (q: string, opts: any) => {
        queriedUserId = opts?.userId;
        return ragEngine.search(q, opts);
      },
    } as any;

    const provider = new OllamaLLMProvider(mockRAGEngine, {
      fetchFn: async () => new Response(JSON.stringify(validStoryResponse)),
    });

    // Invoke with authenticated userId = 1
    await provider.generateStory(mockBrand, 'Topic', undefined, undefined, 1);
    assert.equal(queriedUserId, 1, 'Authenticated userId must be passed directly to RAG search');

    // User 2 cannot access User 1 private knowledge
    const resultsUser2 = ragEngine.search('Secret', { userId: 2 });
    assert.equal(resultsUser2.length, 0, 'User 2 cannot retrieve User 1 private RAG knowledge');
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('31. Client-supplied owner identity cannot override authenticated identity', () => {
  // Verifies that ownerId in brand is strictly ignored when explicit authenticated userId is passed
  const brandWithForgedOwner: any = {
    ...mockBrand,
    ownerId: 9999, // Forged owner
  };

  let receivedTargetUserId: number | undefined;
  const mockRAG = {
    search: (_q: string, opts: any) => {
      receivedTargetUserId = opts?.userId;
      return [];
    },
  } as any;

  const provider = new LocalLLMProvider(mockRAG);
  // Backend session passes authenticated userId = 5
  provider.generateStory(brandWithForgedOwner, 'Topic', undefined, undefined, 5);
  assert.equal(receivedTargetUserId, 5, 'Session-provided authenticated userId (5) must override forged brand ownerId (9999)');
});

test('32. Raw provider errors and private RAG content are not exposed', async () => {
  const mockFetch: typeof fetch = async () => {
    // Return error message containing internal path and credential leaks
    return new Response(
      'Fatal error in /var/internal/ollama/daemon.go: secret_api_key=XYZ123 failed',
      { status: 502 }
    );
  };

  const provider = new OllamaLLMProvider(undefined, { fetchFn: mockFetch });

  try {
    await provider.generateStory(mockBrand, 'Secret Topic');
    assert.fail('Should have thrown SanitizedLLMError');
  } catch (err: any) {
    assert.ok(err instanceof SanitizedLLMError);
    assert.equal(err.code, 'LLM_INVALID_RESPONSE');
    assert.ok(!err.message.includes('/var/internal/ollama'), 'Internal paths must be stripped');
    assert.ok(!err.message.includes('XYZ123'), 'Internal secrets must be stripped');
  }
});

// ============================================================================
// Diagnostics Snapshot Test
// ============================================================================

test('Operational Diagnostics - getDiagnostics reports complete sanitized metrics', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/version')) return new Response('{"version":"0.5.1"}');
      if (u.includes('/api/ps')) return new Response('{"models":[]}');
      return new Response('{}');
    };

    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });

    // Check availability and status
    await adapterInstance.isAvailable();
    await adapterInstance.getStatus();

    const diagnostics = await adapterInstance.getDiagnostics(coordinator);
    assert.equal(diagnostics.coordinatorState, 'IDLE');
    assert.equal(diagnostics.activeLLMRequestCount, 0);
    assert.equal(diagnostics.queuedLLMRequestCount, 0);
    assert.equal(diagnostics.currentReservationId, null);
    assert.equal(diagnostics.providerHealthObservation?.available, true);
    assert.equal(diagnostics.modelResidencyObservation?.resident, false);
    assert.equal(diagnostics.recoveryRequired, false);
  } finally {
    cleanup();
  }
});

// ============================================================================
// Optional Opt-In: Live Ollama Integration Test
// ============================================================================

test(
  'Live Local Ollama Integration (opt-in via AURAVO_LIVE_OLLAMA_TEST=1)',
  { skip: process.env.AURAVO_LIVE_OLLAMA_TEST !== '1' },
  async () => {
    const { adapter, cleanup } = createTestPersistence();
    try {
      const coordinator = new ResourceCoordinator({ persistence: adapter });
      const adapterInstance = new OllamaLifecycleAdapter({ model: 'qwen2.5:1.5b' });
      const provider = new OllamaLLMProvider(undefined, {
        coordinator,
        lifecycleAdapter: adapterInstance,
      });

      const isUp = await adapterInstance.isAvailable();
      if (!isUp) {
        console.warn('Ollama daemon not reachable at 127.0.0.1:11434; skipping live test.');
        return;
      }

      console.log('Testing live Ollama inference with coordinator...');
      const ideas = await provider.generateIdeas(mockBrand, 2);
      assert.ok(ideas.length >= 1);
      assert.ok(ideas[0].metadata?.reservationId);

      console.log('Testing live model unload...');
      const unloadObs = await adapterInstance.coordinatedUnload(coordinator);
      assert.equal(unloadObs.status, 'VERIFIED_UNLOADED');
      console.log('Live Ollama lifecycle test complete!');
    } finally {
      cleanup();
    }
  }
);


// ============================================================================
// Phase 2.3.2.2 Remediation Verification Tests (Tests 33–44)
// ============================================================================

test('33. Recovery deadlock fix: in-process reservation unloads model and restores IDLE without deadlock', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let unloadCalled = false;
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/generate')) {
        unloadCalled = true;
        return new Response('{"done":true}');
      }
      if (u.includes('/api/ps')) {
        if (unloadCalled) {
          return new Response('{"models":[]}');
        }
        return new Response('{"models":[{"name":"qwen2.5:1.5b"}]}');
      }
      return new Response('{}');
    };

    const lifecycleAdapter = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const providers = new Map<ResourceType, IResourceProviderLifecycle>([['LLM', lifecycleAdapter]]);
    const coordinator = new ResourceCoordinator({ persistence: adapter, providers });

    // Acquire reservation in current process
    const resv = await coordinator.acquire('LLM', 'test-worker', { pid: process.pid });
    assert.equal(coordinator.getState(), 'ACTIVE');

    // Simulate mid-stream failure locking coordinator
    coordinator.markRecoveryRequired(resv.id, 'Simulated mid-stream socket drop');
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');

    // Run recovery - must NOT deadlock, must unload model and return recovered: true
    const recoveryResult = await coordinator.recover(resv.id, { callerId: 'test-worker' });
    assert.equal(recoveryResult.recovered, true);
    assert.equal(unloadCalled, true);
    assert.equal(coordinator.getState(), 'IDLE');
    assert.deepEqual(recoveryResult.lifecycleTrail, [
      'RECOVERY_INSPECTING',
      'RECOVERY_UNLOADING',
      'RECOVERY_VERIFYING',
      'RELEASED',
      'IDLE',
    ]);
  } finally {
    cleanup();
  }
});

test('34. Mid-stream socket disruption triggers RECOVERY_REQUIRED without auto-release', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const mockFetch: typeof fetch = async () => {
      const err = new TypeError('fetch failed');
      (err as any).cause = { code: 'UND_ERR_SOCKET', message: 'other side closed' };
      throw err;
    };

    const lifecycleAdapter = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      coordinator,
      lifecycleAdapter,
      fetchFn: mockFetch,
    });

    try {
      await provider.generateStory(mockBrand, 'Test Disruption');
      assert.fail('Should have thrown SanitizedLLMError');
    } catch (err: any) {
      assert.ok(err instanceof SanitizedLLMError);
      assert.equal(err.code, 'LLM_UNCERTAIN_DISRUPTION');
      assert.equal(err.evidence, 'TERMINATION_UNCERTAIN');
    }

    // Coordinator MUST be in RECOVERY_REQUIRED and reservation NOT released
    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
    assert.ok(coordinator.getActiveReservation() !== null);
    assert.equal(coordinator.getActiveReservation()?.status, 'RECOVERY_REQUIRED');

    // Conflicting request is rejected
    await assert.rejects(
      () => coordinator.acquire('SDXL', 'worker-2', { timeoutMs: 100 }),
      (err: any) => err.code === 'TIMEOUT' || err.code === 'RECOVERY_REQUIRED'
    );
  } finally {
    cleanup();
  }
});

test('35. Initial connection refusal (ECONNREFUSED) throws LLM_UNAVAILABLE and cleanly releases reservation', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const coordinator = new ResourceCoordinator({ persistence: adapter });
    const mockFetch: typeof fetch = async () => {
      const err = new TypeError('fetch failed');
      (err as any).cause = { code: 'ECONNREFUSED', syscall: 'connect' };
      throw err;
    };

    const lifecycleAdapter = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const provider = new OllamaLLMProvider(undefined, {
      coordinator,
      lifecycleAdapter,
      fetchFn: mockFetch,
    });

    const fallback = new FallbackLLMProvider(provider, new LocalLLMProvider());
    const story = await fallback.generateStory(mockBrand, 'Refusal Test');

    assert.ok(story.title);
    assert.equal(story.metadata?.provider, 'deterministic');
    assert.equal(story.metadata?.fallbackOccurred, true);
    assert.equal(story.metadata?.fallbackReason, 'LLM_UNAVAILABLE');
    assert.equal(story.metadata?.errorEvidence, 'NOT_DISPATCHED');
    assert.equal(coordinator.getState(), 'IDLE');
    assert.equal(coordinator.getActiveReservation(), null);
  } finally {
    cleanup();
  }
});

test('36. Fail-closed provider status: error or timeout yields UNKNOWN and never NOT_RESIDENT', async () => {
  const mockFetch500: typeof fetch = async () => new Response('Daemon error', { status: 500 });
  const adapter500 = new OllamaLifecycleAdapter({ fetchFn: mockFetch500 });
  const status500 = await adapter500.getStatus();
  assert.equal(status500.residency, 'UNKNOWN');
  assert.equal(status500.loaded, false);

  const verified500 = await adapter500.verifyReleased();
  assert.equal(verified500, false, 'verifyReleased must fail closed on UNKNOWN residency');

  const mockFetchTimeout: typeof fetch = async () => {
    const err = new Error('Request timed out');
    err.name = 'TimeoutError';
    throw err;
  };
  const adapterTimeout = new OllamaLifecycleAdapter({ fetchFn: mockFetchTimeout });
  const statusTimeout = await adapterTimeout.getStatus();
  assert.equal(statusTimeout.residency, 'UNKNOWN');
  assert.equal(statusTimeout.loaded, false);
  const verifiedTimeout = await adapterTimeout.verifyReleased();
  assert.equal(verifiedTimeout, false, 'verifyReleased must fail closed on timeout');
});

test('37. Resident model pre-admission unload: acquiring SDXL when LLM is RESIDENT forces unload', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    let unloadTriggered = false;
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/generate')) {
        unloadTriggered = true;
        return new Response('{"done":true}');
      }
      if (u.includes('/api/ps')) {
        if (unloadTriggered) {
          return new Response('{"models":[]}');
        }
        return new Response('{"models":[{"name":"qwen2.5:1.5b"}]}');
      }
      return new Response('{}');
    };

    const lifecycleAdapter = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const providers = new Map<ResourceType, IResourceProviderLifecycle>([['LLM', lifecycleAdapter]]);
    const coordinator = new ResourceCoordinator({ persistence: adapter, providers });

    // Acquire SDXL: should prepare admission by unloading resident LLM
    const sdxlResv = await coordinator.acquire('SDXL', 'worker-sdxl');
    assert.equal(unloadTriggered, true, 'LLM unload should have been triggered before admitting SDXL');
    assert.equal(coordinator.getState(), 'ACTIVE');
    assert.equal(coordinator.getActiveReservation()?.resourceType, 'SDXL');
    await sdxlResv.release();
    assert.equal(coordinator.getState(), 'IDLE');
  } finally {
    cleanup();
  }
});

test('38. Resident model pre-admission unload failure: if LLM unload fails, SDXL is rejected and coordinator locks', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/generate')) {
        return new Response('Unload failed', { status: 500 });
      }
      if (u.includes('/api/ps')) {
        // Model stays resident
        return new Response('{"models":[{"name":"qwen2.5:1.5b"}]}');
      }
      return new Response('{}');
    };

    const lifecycleAdapter = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const providers = new Map<ResourceType, IResourceProviderLifecycle>([['LLM', lifecycleAdapter]]);
    const coordinator = new ResourceCoordinator({ persistence: adapter, providers });

    await assert.rejects(
      () => coordinator.acquire('SDXL', 'worker-sdxl'),
      (err: any) => {
        assert.ok(err instanceof ResourceCoordinatorError);
        assert.equal(err.code, 'PREPARATION_FAILED');
        return true;
      }
    );

    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('39. Resident model pre-admission: if LLM status is UNKNOWN, SDXL is rejected fail-closed', async () => {
  const { adapter, cleanup } = createTestPersistence();
  try {
    const mockFetch: typeof fetch = async () => new Response('Ollama down', { status: 503 });

    const lifecycleAdapter = new OllamaLifecycleAdapter({ fetchFn: mockFetch });
    const providers = new Map<ResourceType, IResourceProviderLifecycle>([['LLM', lifecycleAdapter]]);
    const coordinator = new ResourceCoordinator({ persistence: adapter, providers });

    await assert.rejects(
      () => coordinator.acquire('SDXL', 'worker-sdxl'),
      (err: any) => {
        assert.ok(err instanceof ResourceCoordinatorError);
        assert.equal(err.code, 'PREPARATION_FAILED');
        return true;
      }
    );

    assert.equal(coordinator.getState(), 'RECOVERY_REQUIRED');
  } finally {
    cleanup();
  }
});

test('40. Unload retry polling loops up to 10 retries at specified interval', async () => {
  let psCount = 0;
  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/generate')) {
      return new Response('{"done":true}');
    }
    if (u.includes('/api/ps')) {
      psCount++;
      if (psCount >= 3) {
        return new Response('{"models":[]}');
      }
      return new Response('{"models":[{"name":"qwen2.5:1.5b"}]}');
    }
    return new Response('{}');
  };

  const coordinator = new ResourceCoordinator();
  const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });

  const result = await adapterInstance.coordinatedUnload(coordinator, {
    pollRetries: 10,
    pollIntervalMs: 10,
  });

  assert.equal(result.status, 'VERIFIED_UNLOADED');
  assert.equal(result.psReportedNotResident, true);
  assert.ok(psCount >= 3);
});

test('41. Unload retry polling returns FAILED_STILL_RESIDENT after retries exhausted', async () => {
  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/generate')) {
      return new Response('{"done":true}');
    }
    if (u.includes('/api/ps')) {
      return new Response('{"models":[{"name":"qwen2.5:1.5b"}]}');
    }
    return new Response('{}');
  };

  const coordinator = new ResourceCoordinator();
  const adapterInstance = new OllamaLifecycleAdapter({ fetchFn: mockFetch });

  const result = await adapterInstance.coordinatedUnload(coordinator, {
    pollRetries: 3,
    pollIntervalMs: 10,
  });

  assert.equal(result.status, 'FAILED_STILL_RESIDENT');
  assert.equal(result.psReportedNotResident, false);
});

test('42. Model availability diagnostics accurately identifies MODEL_NOT_INSTALLED', async () => {
  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'moondream:latest' }] }));
    }
    return new Response('{}');
  };

  const adapterInstance = new OllamaLifecycleAdapter({ model: 'qwen2.5:1.5b', fetchFn: mockFetch });
  const status = await adapterInstance.checkModelAvailability();
  assert.equal(status.status, 'MODEL_NOT_INSTALLED');
  assert.equal(status.isConfiguredModelInstalled, false);
  assert.equal(status.daemonAvailable, true);
  assert.deepEqual(status.installedModels, ['moondream:latest']);
});

test('43. Model availability diagnostics accurately identifies AVAILABLE', async () => {
  const mockFetch: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'qwen2.5:1.5b:latest' }] }));
    }
    return new Response('{}');
  };

  const adapterInstance = new OllamaLifecycleAdapter({ model: 'qwen2.5:1.5b', fetchFn: mockFetch });
  const status = await adapterInstance.checkModelAvailability();
  assert.equal(status.status, 'AVAILABLE');
  assert.equal(status.isConfiguredModelInstalled, true);
  assert.equal(status.daemonAvailable, true);
});

test('44. Model availability diagnostics accurately identifies DAEMON_UNAVAILABLE', async () => {
  const mockFetch: typeof fetch = async () => {
    const err = new TypeError('fetch failed');
    (err as any).cause = { code: 'ECONNREFUSED' };
    throw err;
  };

  const adapterInstance = new OllamaLifecycleAdapter({ model: 'qwen2.5:1.5b', fetchFn: mockFetch });
  const status = await adapterInstance.checkModelAvailability();
  assert.equal(status.status, 'DAEMON_UNAVAILABLE');
  assert.equal(status.isConfiguredModelInstalled, false);
  assert.equal(status.daemonAvailable, false);
  assert.deepEqual(status.installedModels, []);
});
