# Auravo Studio — AI-Foundation 2.3.2.1: Ollama Lifecycle Safety, Recovery & Memory Admission Audit

**Phase:** AI-Foundation 2.3.2.1  
**Date:** November 17, 2026  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Branch:** `main`  
**Baseline Git HEAD:** `1946bb3159b672dcce250e62446029234d191283`  
**Active Database:** `data/studio.db`  
**Database Checksum (SHA-256):** `73276052355de0905a61e8d4acbd8772e74e5f4613d866ac02d5bfa9c2c46ed5`  
**Database Size:** 196,608 bytes  
**Auditor Verdict:** `REQUIRE_PHASE_2_3_2_2_REMEDIATION`

---

## 1. Executive Verdict

This independent audit conducted a strict, evidence-driven, read-only forensic inspection of the Phase 2.3.2 implementation (`OllamaLLMProvider`, `OllamaLifecycleAdapter`, `ResourceCoordinator`, and associated test suites).

While Phase 2.3.2 successfully introduced the foundation for coordinated resource reservations, strict serialization, and tenant isolation, **the implementation cannot be approved for Phase 2.3.3 (SDXL Integration) in its current state.**

The audit discovered **three Critical vulnerabilities** and **two High-priority architectural gaps** that directly threaten system stability and memory safety under real-world runtime conditions:

1. **Recovery Deadlock / Permanent Lock (CRITICAL):** When an inference request times out or aborts, `OllamaLLMProvider` transitions the coordinator to `RECOVERY_REQUIRED`. However:
   - `OllamaLLMProvider.executeWithCoordination()` omits `options.pid`. As a result, the persisted reservation has `pid: NULL`.
   - `ResourceCoordinator.recover()` line 509 evaluates `if (record.pid)`. Because `pid` is `NULL`, it takes the `else` branch and returns `{ recovered: false, reason: 'UNVERIFIED_PROCESS_STATE' }`, permanently refusing recovery.
   - Concurrently, `OllamaLifecycleAdapter.coordinatedUnload()` attempts to acquire an exclusive `LLM` reservation via `coordinator.acquire('LLM')`. But `coordinator.acquire` is rejected because `coordinatorState === 'RECOVERY_REQUIRED'`, and `processQueue()` ignores the waiting queue in that state.
   - **Result:** Once a timeout or abort occurs, the system enters an unrecoverable deadlock where neither normal requests, nor `coordinator.recover()`, nor `coordinatedUnload()` can ever clear the lock.
2. **Mid-Stream Socket Disruption Unsafely Releases Reservation (CRITICAL):** In real Node.js (`undici`), an interrupted HTTP socket or broken pipe produces `TypeError: fetch failed`. In `OllamaLLMProvider.callChat()` (lines 449–452), `msg.includes('fetch failed')` maps this to `LLM_UNAVAILABLE`. `LLM_UNAVAILABLE` is classified under `isVerifiedTerminal` (line 384), causing `executeWithCoordination()` to **release the reservation immediately**, despite the fact that Ollama/llama.cpp may still be executing background token generation in VRAM.
3. **`/api/ps` Query Failure Treated as Proof of Unload (CRITICAL):** In `OllamaLifecycleAdapter.getStatus()` (lines 127–156), if the HTTP call to `/api/ps` times out or fails, the method swallows the error and returns `{ loaded: false, providerState: 'QUERY_FAILED' }`. In `verifyReleased()` and `coordinator.recover()`, the code checks `if (!status.loaded)`. Because `loaded` is `false`, **a network or daemon failure is treated as positive proof that the model is absent from memory (fail-open)**.
4. **Memory Collision on Normal Completion (HIGH):** In default operation (`unloadOnRelease: false`), normal request completion releases the coordinator reservation back to `IDLE` while the Ollama model remains resident in unified memory. If an SDXL request is submitted when the coordinator is `IDLE`, the coordinator immediately admits SDXL without commanding or verifying Ollama model unload.
5. **Missing Target Model on Host (HIGH):** Read-only inspection of the live Ollama daemon (`/api/tags`) reveals that `qwen2.5:1.5b` is **not installed** on this machine. Only `moondream:latest` (1.7 GB) is installed. The Phase 2.3.2 preflight report claimed `qwen2.5:1.5b` was healthy and resident. Any live inference without mocks will fail with HTTP 404.

**Recommendation:** `REQUIRE_PHASE_2_3_2_2_REMEDIATION` before authorizing Phase 2.3.3.

---

## 2. Repository & Database Baseline

All measurements were taken via read-only tools without modifying any file, process, or database record.

| Parameter | Observed Baseline Evidence | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Git Current Branch** | `main` | `git branch --show-current` | Verified |
| **Git Commit HEAD** | `1946bb3159b672dcce250e62446029234d191283` | `git rev-parse HEAD` | Verified |
| **Git Status** | 4 tracked modifications (`server/app.ts`, `server/content_engine.ts`, `server/providers/llm.ts`, `server/providers/types.ts`) + untracked reports & coordinator files | `git status --short` | Recorded |
| **Authoritative DB Path** | `/Users/abhisheksuman/Documents/GitHub/studio/data/studio.db` | Filesystem inspection | Verified |
| **Database File Size** | 196,608 bytes | `ls -l data/studio.db` | Verified |
| **Database Checksum (SHA-256)**| `73276052355de0905a61e8d4acbd8772e74e5f4613d866ac02d5bfa9c2c46ed5` | `shasum -a 256` | Identical to Phase 2.3.1.5 |
| **Applied Migrations** | 12 migrations (001–012 complete, ordered) | `sqlite3 -readonly SELECT name FROM _migrations` | Verified |
| **Database Table Count** | 19 tables, 4 triggers | `sqlite3 -readonly sqlite_master` | Verified |
| **Application Records** | 0 users, 0 brands, 0 jobs, 0 reservations | `sqlite3 -readonly` queries | Clean Fresh Start |
| **RAG Seed Records** | 12 canonical system default items | `sqlite3 -readonly rag_knowledge` | Verified |
| **Ollama Daemon Process** | PID 718 (`/opt/homebrew/opt/ollama/bin/ollama serve`), listening on `127.0.0.1:11434` | `lsof -i :11434`, `ps -fp 718` | Alive & Active |
| **Ollama Daemon Version** | `0.18.2` | `curl -s http://127.0.0.1:11434/api/version` | Verified |
| **In-Memory Models (/api/ps)** | `{"models":[]}` (No models currently resident in VRAM) | `curl -s http://127.0.0.1:11434/api/ps` | Verified Empty |
| **Installed Models (/api/tags)** | `moondream:latest` (1.7 GB, modified 7 months ago) | `curl -s http://127.0.0.1:11434/api/tags` | **`qwen2.5:1.5b` ABSENT** |

---

## 3. Workstream A — Recovery Deadlock Audit

### 3.1 Investigated Sequence
1. Ollama inference is dispatched.
2. Client times out or aborts.
3. Reservation remains in `RECOVERY_REQUIRED`.
4. Coordinator rejects normal admissions.
5. Recovery attempts to unload the model.
6. Unload routine attempts to acquire an LLM reservation.

### 3.2 Forensic Source Evidence
- **File:** `server/providers/llm.ts`, lines 356–363:
  ```typescript
  const admissionTimeout = this.admissionTimeoutMs ?? this.timeoutMs;
  const reservation = await this.coordinator.acquire('LLM', ownerId, {
    metadata: { operation, model: this.model, ...metadata },
    timeoutMs: admissionTimeout,
    // BUG: pid is completely omitted!
  });
  ```
  `options.pid` is not passed. In `ResourceCoordinator.grantAdmission()`, `record.pid` is assigned `undefined` and persisted as `NULL`.

- **File:** `server/coordinator/coordinator.ts`, lines 493–515:
  ```typescript
  if (record.pid) {
    const isAlive = this.processLiveness.isProcessAlive(record.pid);
    ...
  } else {
    // Missing PID with unresolved status is ambiguous -> FAIL CLOSED
    this.coordinatorState = 'RECOVERY_REQUIRED';
    record.status = 'RECOVERY_REQUIRED';
    this.persistence?.updateStatus(targetId, 'RECOVERY_REQUIRED', 'Ambiguous unverified process state');
    return { recovered: false, reason: 'UNVERIFIED_PROCESS_STATE' };
  }
  ```
  Because `record.pid` is `NULL`, `coordinator.recover()` **unconditionally rejects recovery** with `UNVERIFIED_PROCESS_STATE`.

- **File:** `server/coordinator/ollama_lifecycle.ts`, lines 300–305:
  ```typescript
  // Step 1: Acquire exclusive reservation to block any new admissions
  const reservation = await coordinator.acquire('LLM', ownerId, {
    timeoutMs,
    metadata: { operation: 'MODEL_UNLOAD', model: this.model, unload: true },
  });
  ```
  `coordinatedUnload()` calls `coordinator.acquire('LLM')`.

- **File:** `server/coordinator/coordinator.ts`, lines 149–153 & lines 334–337:
  ```typescript
  const canAdmitNow =
    this.waitingQueue.length === 0 &&
    this.coordinatorState === 'IDLE' &&
    ResourceCompatibilityPolicy.canAdmit(resourceType, activeTypes);
  ```
  `canAdmitNow` is `false` because `coordinatorState === 'RECOVERY_REQUIRED'`.
  The unload request is pushed to `this.waitingQueue`.
  In `processQueue()`:
  ```typescript
  if (this.coordinatorState === 'SHUTDOWN' || this.coordinatorState === 'RECOVERY_REQUIRED') {
    return;
  }
  ```
  `processQueue()` immediately aborts. The unload request remains queued until its 30-second timeout expires, then rejects with `TIMEOUT`.

### 3.3 Workstream A Audit Answers
1. **Can recovery execute while ordinary admission is blocked?**  
   `coordinator.recover()` can be invoked, but it fails immediately (`UNVERIFIED_PROCESS_STATE`) because `pid` was not persisted.
2. **Can the unload operation acquire the required authority while an unresolved reservation exists?**  
   **NO.** `coordinatedUnload()` deadlocks in `coordinator.acquire()` waiting for an admission that `processQueue()` refuses to process.
3. **Is the recovery path narrowly scoped and owner-validated?**  
   `coordinator.recover()` accepts an optional `reservationId`, but performs no caller authorization or owner matching.
4. **Can recovery accidentally release a reservation without verifying daemon state?**  
   If `pid` were present and dead, `coordinator.recover()` calls `provider.getStatus()`. If `getStatus()` fails, it swallows the error (see Workstream B/F) and releases the reservation without valid daemon verification.
5. **Can an ordinary request exploit any recovery bypass?**  
   No. Ordinary requests are completely blocked when `coordinatorState === 'RECOVERY_REQUIRED'`.
6. **What happens if recovery itself times out or the daemon is unreachable?**  
   The system remains locked in `RECOVERY_REQUIRED`.

**Classification:** `FAIL — RECOVERY DEADLOCK OR UNRECOVERABLE LOCK`

---

## 4. Workstream B — Error Classification & Termination Evidence

Every error branch in `OllamaLLMProvider.executeWithCoordination()` and `callChat()` was audited against actual Node.js networking behavior:

| Error Condition | Was Request Dispatched? | Is Daemon Termination Proven? | Current Code Action | Actual Safety Classification | Forensic Finding |
| :--- | :---: | :---: | :--- | :---: | :--- |
| **Connection Refused (`ECONNREFUSED`)** | Attempted, rejected | Yes (Port closed) | Released (`isVerifiedTerminal`) | `PASS` | Safe; daemon never accepted the socket connection. |
| **DNS / Host Resolution Failure** | No | Yes (Not reached) | Released (`isVerifiedTerminal`) | `PASS` | Safe; no remote compute started. |
| **HTTP 400 Bad Request** | Yes | Yes (Rejected before inference) | Released (`LLM_INVALID_RESPONSE`) | `PASS` | Safe; Ollama completed HTTP error response. |
| **HTTP 404 Model Not Found** | Yes | Yes (No model loaded) | Released (`LLM_MODEL_NOT_FOUND`) | `PASS` | Safe; Ollama rejected without compute. |
| **HTTP 500 Internal Error** | Yes | Partial (HTTP stream closed, but model may be resident) | Released (`LLM_INVALID_RESPONSE`) | `PARTIAL` | HTTP stream ended, but Ollama model weights remain resident in VRAM. |
| **Invalid JSON Response** | Yes | Yes (Full body received) | Released (`LLM_INVALID_RESPONSE`) | `PASS` | Full HTTP payload was received from Ollama. |
| **Invalid Structured Output** | Yes | Yes (Generation finished) | Released (`LLM_INVALID_OUTPUT`) | `PASS` | Inference completed; JSON failed schema validation. |
| **Client Timeout (`AbortSignal.timeout`)** | Yes | **NO** (Daemon may still be generating) | Retained (`RECOVERY_REQUIRED`) | `PASS` | Correctly fail-closed. |
| **Client Abort Signal (`AbortController`)** | Yes | **NO** (Daemon unaware of intent) | Retained (`RECOVERY_REQUIRED`) | `PASS` | Correctly fail-closed. |
| **Socket Hang-Up / Broken Pipe** | Yes | **NO** (Daemon may be actively computing) | **Released (`LLM_UNAVAILABLE`)** | **`CRITICAL FAIL`** | **CRITICAL FLAW:** Node.js wraps mid-stream socket disruptions in `TypeError: fetch failed`. Lines 449–452 convert this to `LLM_UNAVAILABLE`. Line 384 treats it as `isVerifiedTerminal` and **releases the reservation unsafely**. |
| **Mid-Stream Partial Response Interruption** | Yes | **NO** (Inference was actively executing) | **Released (`LLM_UNAVAILABLE`)** | **`CRITICAL FAIL`** | Same as above. Client socket closure does not halt llama.cpp. |
| **Process Shutdown** | Interrupted | Unproven | Retained across restart | `PASS` | Verified by startup reconciliation logic. |
| **Daemon Unreachable During Verification** | Verification call | **NO** | **Treated as Unloaded (`loaded: false`)** | **`CRITICAL FAIL`** | `getStatus()` swallows error; caller assumes model is absent. |

---

## 5. Workstream C — Resident Model vs Active Request Accounting

### 5.1 Accounting Breakdown

The implementation introduces multiple discrete lifecycle states, but they are tracked across disparate modules:

1. **Active HTTP Request:** Tracked in `OllamaLifecycleAdapter.activeRequests` map as `InFlightRequest` (`status: 'ACTIVE' | 'DRAINING' | 'COMPLETED' | 'FAILED'`).
2. **Active Inference:** Synonymous with active HTTP request in the current client implementation.
3. **Queued Request:** Tracked in `ResourceCoordinator.waitingQueue` array.
4. **Resident Ollama Model:** Observable via `GET /api/ps`, which returns the list of resident models and their VRAM allocations.
5. **Model Unload Requested:** Triggered by `POST /api/generate` with `{ model, keep_alive: 0 }`.
6. **Model Unload Verified:** Verified when `/api/ps` reports an empty array or does not list the model.
7. **Actual OS / Metal Memory Reclamation:** Explicitly hardcoded as unproven (`metalMemoryDeallocationProven: false`, `systemMemoryPressureRecoveredProven: false`).

### 5.2 Workstream C Audit Answers
1. **Does normal request completion release the reservation while the model remains resident?**  
   **YES.** By default, `unloadOnRelease` is `false`. Upon normal completion, `executeWithCoordination()` releases the reservation, returning `coordinatorState` to `'IDLE'`, while Ollama retains the model weights in VRAM.
2. **Can the coordinator report `IDLE` while Ollama still holds model weights?**  
   **YES.**
3. **Is resident model state represented in coordinator state or a separate verified state?**  
   It is **NOT** represented in `coordinatorState`. It exists solely inside `OllamaLifecycleAdapter.lastResidencyObservation`.
4. **Can a memory-intensive workload be admitted while the model remains resident?**  
   **YES.** Once the coordinator returns to `'IDLE'`, a future call to `coordinator.acquire('SDXL')` will be granted immediately because the compatibility policy checks active reservations, not daemon residency.
5. **Is model unloading automatically triggered before such a workload?**  
   **NO.** There is no automated hook in the coordinator to trigger unload before admitting a conflicting resource type.
6. **Is unloading verified before the external process is spawned?**  
   **NO.**
7. **What happens if `/api/ps` is unavailable or reports inconsistent state?**  
   In `OllamaLifecycleAdapter.getStatus()` (lines 127–156), any HTTP failure or exception causes the method to return `{ loaded: false }`. This false negative allows unload verification to succeed erroneously.

**Classification:** `FAIL — CRITICAL ARCHITECTURAL GAP`

---

## 6. Workstream D — Future SDXL Admission Contract

The audit inspected whether Phase 2.3.2 creates a viable architectural contract for SDXL admission in Phase 2.3.3:

| Step | Contract Requirement | Current Implementation Status | Gap Analysis |
| :-: | :--- | :---: | :--- |
| **1** | Admission request | **Implemented** | `coordinator.acquire('SDXL', ownerId)` exists. |
| **2** | Block new LLM requests | **Implemented** | While SDXL is active, compatibility policy blocks all LLM admissions. |
| **3** | Drain active LLM requests | **Partially Implemented** | Drain logic exists in `coordinatedUnload()`, but is not tied to SDXL admission. |
| **4** | Verified Ollama unload | **Not Implemented in Admission** | The coordinator grants SDXL admission immediately without checking Ollama residency. |
| **5** | Verify no unresolved LLM reservations | **Implemented** | Enforced if the coordinator is in `RECOVERY_REQUIRED`. |
| **6** | Spawn SDXL process only after verified unload | **Not Implemented** | Outside Phase 2.3.2 scope; no SDXL process runner exists. |
| **7** | SDXL completion & verified process exit | **Not Implemented** | Outside Phase 2.3.2 scope. |
| **8** | Safe release of SDXL reservation | **Implemented** | Standard `coordinator.release()` handle exists. |

**Key Finding:** Mutual exclusivity declared in `ResourceCompatibilityPolicy` (`COMPATIBILITY_MATRIX`) only protects against concurrent active reservations; it provides **zero protection against resident memory collisions**. An SDXL process admitted on an `IDLE` coordinator will collide with the resident Ollama model unless pre-admission unload verification is built into the coordinator.

---

## 7. Workstream E — Outstanding Request & Unload Drain Audit

### 7.1 Request Tracking Inspection
- **File:** `server/coordinator/ollama_lifecycle.ts`, lines 59–67:
  `InFlightRequest` tracks `reservationId`, `ownerId`, `startedAt`, `status`, `uncertain`, and `completedAt`.
- **Gaps:**
  - No unique request ID (keyed only by `reservationId`).
  - No tracking of client socket state.
  - If a reservation ID is not found in `activeRequests` (e.g. after process restart), `verifyReleased()` (line 241) defaults to returning `true`.

### 7.2 Polling & Drain Timing Inspection
- **Drain Timeout:** `options.maxDrainWaitMs` defaults to **15,000 ms** (line 298), polling every 50 ms.
- **Residency Polling Policy Discrepancy:** The Phase 2.3.2 report claimed: *"Poll residency via /api/ps up to 10 times with 100 ms intervals until models array no longer contains the model"*.
- **Actual Code:** In `coordinatedUnload()` (line 336), `getStatus()` is called **only ONCE**:
  ```typescript
  const status = await this.getStatus();
  const psReportedNotResident = !status.loaded;
  ```
  There is **no polling loop**. If Ollama requires 150 ms to deallocate the model weights, the single check immediately fails unload verification.

**Classification:** `MEDIUM RISK (Implementation Discrepancy & Single-Shot Polling)`

---

## 8. Workstream F — Restart & Stale Reservation Recovery

| Scenario | Required Safe Behavior | Code Implementation | Status |
| :--- | :--- | :--- | :---: |
| **Node dead, Ollama alive** | Do not assume workload stopped | Checks `isProcessAlive(record.pid)`. If dead, queries `provider.getStatus()`. If loaded, fails closed (`PROVIDER_STILL_LOADED`). | `PASS` |
| **Node dead, daemon unavailable** | Recovery required | In `coordinator.ts` line 529: if `provider.getStatus()` throws, fails closed (`PROVIDER_QUERY_FAILED`). | `PASS` |
| **Node alive, status unknown** | Recovery required | If `isProcessAlive` returns `true`, fails closed (`PROCESS_STILL_ALIVE`). | `PASS` |
| **PID reused by OS** | Do not trust PID alone | `ProcessLivenessChecker` uses `process.kill(pid, 0)`. Does not verify process creation time or cmdline. | `MEDIUM RISK` |
| **Owner unavailable** | Do not silently release | Recovery releases if PID dead and daemon unloaded. No owner authorization checked on `recover()`. | `MEDIUM RISK` |
| **Model resident after restart** | Do not assume no active work | Fails closed (`PROVIDER_STILL_LOADED`). | `PASS` |
| **Model absent, daemon state uncertain** | Do not assume execution stopped | **FLAW:** `getStatus()` returns `{ loaded: false }` on network failure. `recover()` line 522 checks `if (status.loaded)`. Because `loaded` is `false`, it assumes unloaded and releases the reservation unsafely! | **`HIGH RISK`** |
| **TTL expired, process alive** | Never reclaim on TTL alone | Verified. Coordinator does not perform TTL-only reclamation. | `PASS` |
| **TTL expired, provider unavailable**| Recovery required | Verified. Fails closed. | `PASS` |

---

## 9. Workstream G — FIFO, Queue & Cancellation Audit

1. **Ordering Mechanism:** `this.waitingQueue` is a native JavaScript array. Dequeuing is performed via `shift()` (index 0). FIFO order is guaranteed by array insertion order, immune to timestamp collisions.
2. **Cancellation:** `cancel(reservationId, ownerId)` locates the request, verifies owner matching, clears the timeout timer, splices the entry, rejects the pending promise with `CANCELLED`, and decrements metrics cleanly.
3. **Admission Timeout:** `handleAdmissionTimeout()` cleanly removes the item from the queue, clears the timer, and rejects with `TIMEOUT`.
4. **Acquisition Failure Leakage:** In `grantAdmission()`, database errors trigger `coordinatorState = 'FAILED'` and throw before assigning `this.activeReservation`.
5. **Single Dequeue Guarantee:** `release()` invokes `processQueue()` exactly once.
6. **Graceful Shutdown:** `shutdown()` sets state to `'SHUTDOWN'`, drains the queue by rejecting all pending requests with `SHUTDOWN`, and leaves active reservations fail-closed in SQLite.
7. **Concurrency Integrity:** Confirmed: no secondary mutex or competing scheduler exists in the codebase.

**Classification:** `PASS`

---

## 10. Workstream H — Authentication & RAG Isolation

### 10.1 Production Call Sites
- `POST /ideas/generate` (`server/content_engine.ts:568`): Extracts `userId = uid(req)` from session. Passes to `getBrandContext(brandId, userId)`, which executes `SELECT * FROM brands WHERE id=? AND ownerId=?`.
- `POST /content/story/generate` (`server/content_engine.ts:663`): Passes authenticated `userId` to `llm.generateStory(...)`.
- `server/providers/llm.ts`: Lines 484 & 585 construct `ownerId` strictly from `user:${userId}` or `brand:${brand.id}`.

### 10.2 RAG Physical Schema Enforcement
`server/providers/rag_engine.ts` lines 192–200 enforce multi-tenant isolation directly in SQL:
```sql
SELECT * FROM rag_knowledge WHERE (ownerId = ? OR isSystemDefault = 1) AND isQuarantined = 0
```
- Runtime user additions via `addKnowledge()` force `isSystemDefault = 0` and `seedKey = NULL`.
- Canonical system defaults require `isSystemDefault = 1` and a recognized `seedKey` (e.g. `canonical_v1_*`).
- User A cannot access User B's private choreography patterns or viral hooks under any circumstances.

**Classification:** `PASS`

---

## 11. Workstream I — Test Evidence & Report Reconciliation

### 11.1 Test Count & Baseline Reconciliation
```
Full Suite:  178 tests | 173 passed | 3 failed | 2 skipped
Baseline:    144 tests | 140 passed | 3 failed | 1 skipped
Net Delta:   +34 tests (33 passed, 1 skipped)
```
- **3 Known Failures:**
  1. `experiments_api.test.ts:160:11`: Missing sample asset `persona_b_latin.png` (404 !== 200).
  2. `experiments_api.test.ts`: Parent suite assertion cascade.
  3. `face_animation.test.ts:24:1`: FFmpeg dummy input `maxBuffer` length exceeded.
  *Confirmed 100% pre-existing at Git baseline `1946bb3159b672dcce250e62446029234d191283`.*

### 11.2 Mock vs Real Execution Evidence
- **Scenarios 1–32 in `ollama_lifecycle.test.ts`:** Executed entirely against **in-memory mock fetch functions**. They verify TypeScript coordination logic, but provide **zero evidence** of real llama.cpp thread interruption, OS socket handling, or kernel unified memory release.
- **Scenario 34 (`Live Local Ollama Integration`):** Skipped by default. When enabled, it cannot test inference because `qwen2.5:1.5b` is not installed on the host.

**Classification:** `PASS (Verification of counts) / PARTIAL (Mocked tests vs real daemon evidence)`

---

## 12. Workstream J — Memory Budget Evidence

The memory budget presented in Phase 2.3.2 Section 6 was audited:

| Component | Reported Budget | Audit Classification | Evidence / Basis |
| :--- | :--- | :---: | :--- |
| **macOS & System Services** | ~5.0 – 6.0 GB | `ESTIMATED` | Typical Apple Silicon macOS idle footprint. Not measured under load. |
| **Node.js / Vite Server** | ~0.3 – 0.5 GB | `ESTIMATED` | V8 heap observed at ~120–220 MB during test runs. |
| **Ollama Daemon + Qwen2.5 1.5B** | ~1.2 – 1.8 GB | `UNSUPPORTED ON HOST` | `qwen2.5:1.5b` is **not installed** on this machine. Figure is theoretical. |
| **SDXL Base 1.0 (PyTorch MPS)** | ~8.0 – 10.5 GB | `HISTORICAL ESTIMATE` | Derived from Phase 1C audit of SDXL Base FP16 + VAE + MPS buffers. Not measured in 2.3.2. |
| **FFmpeg 1080x1920 Video Render** | ~1.0 – 2.0 GB | `ESTIMATED` | Standard libx264 1080p frame buffer calculations. |
| **Coordinated Peak: 10.5–12.5 GB** | ~10.5 – 12.5 GB | `ESTIMATED SUM` | Theoretical sum of serialized peaks. Not directly measured. |

**Critical Audit Note:** The `ResourceCoordinator` enforces **resource name mutual exclusivity**, NOT physical memory limits. It does not monitor `os.freemem()` or GPU allocation pressures.

---

## 13. Critical & High-Priority Findings Summary

### Critical Findings (`CRITICAL`)
1. **CRITICAL-01: Recovery Deadlock on Omitted PID & Queued Unload**
   - *Location:* `server/providers/llm.ts:360`, `server/coordinator/coordinator.ts:509`, `server/coordinator/ollama_lifecycle.ts:301`.
   - *Impact:* Inference timeout/abort permanently locks coordinator in `RECOVERY_REQUIRED`. `recover()` fails due to missing PID; `coordinatedUnload()` hangs in queue because admissions are blocked.
2. **CRITICAL-02: Mid-Stream Socket Interruption Unsafely Releases Reservation**
   - *Location:* `server/providers/llm.ts:450` & `server/providers/llm.ts:384`.
   - *Impact:* Real Node.js broken pipes produce `TypeError: fetch failed`, which is misclassified as `LLM_UNAVAILABLE`, treated as terminal, and released while daemon compute continues.
3. **CRITICAL-03: `/api/ps` Query Errors Default to "Not Resident" (Fail-Open)**
   - *Location:* `server/coordinator/ollama_lifecycle.ts:127–156` & `server/coordinator/coordinator.ts:522`.
   - *Impact:* Network timeouts or 500 errors during `/api/ps` status checks return `loaded: false`, causing recovery and unload verification to falsely assume the model is cleared from memory.

### High-Priority Findings (`HIGH`)
1. **HIGH-01: Memory Collision on Normal Completion (Ollama Resident while Coordinator IDLE)**
   - *Location:* `server/coordinator/ollama_lifecycle.ts:97` & `server/coordinator/coordinator.ts:149`.
   - *Impact:* Coordinator returns to `IDLE` after request completion, leaving model in VRAM. Future SDXL request is granted admission immediately without pre-admission unload.
2. **HIGH-02: Target LLM Model `qwen2.5:1.5b` Not Installed on Machine**
   - *Location:* Live host Ollama daemon (`/api/tags`).
   - *Impact:* Preflight reported model as healthy, but host only contains `moondream:latest`. Live Ollama calls fail with HTTP 404.
3. **HIGH-03: Single-Shot Residency Check in Coordinated Unload**
   - *Location:* `server/coordinator/ollama_lifecycle.ts:336`.
   - *Impact:* Code executes a single check rather than a retry polling loop, risking premature unload failure.

---

## 14. Required Remediation Sequence (Phase 2.3.2.2)

To achieve production safety before Phase 2.3.3, the following remediation sequence must be executed in a dedicated phase (**AI-Foundation 2.3.2.2**):

1. **Pass PID in `executeWithCoordination()`:** Pass `pid: process.pid` to `coordinator.acquire()` so persisted reservations have verifiable process identity.
2. **Add Privileged Recovery / Unload Channel in Coordinator:**
   - Allow `coordinator.recover()` or internal system operations to execute model unloading without queuing through the user admission path.
   - Alternatively, grant `ownerId: 'system:recovery'` the authority to bypass the queue to execute unload during `RECOVERY_REQUIRED`.
3. **Fix Network Error Classification in `callChat()`:**
   - Differentiate connection establishment failure (`fetch failed` with `cause.code === 'ECONNREFUSED'`) from mid-stream socket disruptions.
   - Any mid-stream failure after HTTP headers are dispatched must be classified as `LLM_UNCERTAIN` and trigger `RECOVERY_REQUIRED`.
4. **Make `/api/ps` Status Checks Fail-Closed:**
   - When `/api/ps` throws or returns non-200, `getStatus()` must return `loaded: true` (or `loaded: 'UNKNOWN'`), preventing false-negative release verification.
5. **Implement Pre-Admission Model Unload for Conflicting Workloads:**
   - Before `coordinator.acquire('SDXL')` grants admission, if the LLM provider reports its model is still resident, the coordinator must automatically trigger and verify unload before granting SDXL admission.
6. **Implement Retry Polling in `coordinatedUnload()`:**
   - Implement a 10 × 200 ms retry loop on `/api/ps` after issuing `keep_alive: 0` to accommodate daemon deallocation latency.
7. **Install Target Local Model:**
   - Either pull `qwen2.5:1.5b` via the local Ollama CLI, or configure the application to target an existing installed local model (e.g. `moondream:latest` or other verified local tag).

---

## 15. Final Phase Recommendation

**Recommendation:** `REQUIRE_PHASE_2_3_2_2_REMEDIATION`

Do **NOT** proceed to Phase 2.3.3. Phase 2.3.3 requires running heavy SDXL image generation in an isolated Python subprocess. Admitting SDXL under the current coordinator vulnerabilities risks unrecoverable deadlocks upon timeout and severe out-of-memory kernel thrashing due to uncoordinated resident Ollama models.

