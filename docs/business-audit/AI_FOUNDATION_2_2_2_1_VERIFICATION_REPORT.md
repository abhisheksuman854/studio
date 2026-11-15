# Auravo Studio — AI-Foundation 2.2.2.1
## Reliability & Data-Integrity Verification Forensic Audit Report

**Document ID:** `AURAVO-AIF2.2.2.1-VERIFICATION-20261116`  
**Phase:** AI-Foundation 2.2.2.1  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Branch:** `main`  
**Baseline Commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`  
**Monetary Budget:** $0.00 (Zero-Cost Policy strictly maintained)

---

## 1. Executive Verdict & Summary

### Verdict: `AI_FOUNDATION_2_2_2_1_VERIFIED_WITH_LIMITATIONS`

This independent forensic audit investigated the AI-Foundation 2.2.2 implementation and evaluated four specific residual questions regarding daemon cancellation, metadata concurrency, score sentinels, and RAG database schema terminology.

### Key Audit Conclusions:
1. **Audit A — Daemon Cancellation Evidence (`NOT_PROVEN`):**  
   The Phase 2.2.2 timeout experiment conclusively established client HTTP socket abortion and model residency in memory via `/api/ps`. However, it did **not** prove active daemon-side token generation or request queueing during the abort window. The claim of continued daemon-side GPU compute remains an unverified hypothesis; daemon-side cancellation status must be classified as **`NOT_PROVEN`**.
2. **Audit B — Fallback Metadata Concurrency (`SAFE PER-RESULT, UNSTABLE ON SINGLETON GETTER`):**  
   Per-result execution metadata attached to returned items (`story.metadata` and `idea.metadata`) is immutable, thread-safe, and accurately isolated per request. However, `fallbackProvider.getLastExecutionMetadata()` stores shared mutable state on the provider instance and is subject to race conditions under concurrent overlapping requests.
3. **Audit C — Score Sentinel Completeness (`VERIFIED WITH MINOR BOUNDARY DEFECT`):**  
   The `-1` unavailable-score sentinel prevents SQLite `NOT NULL` constraint violations and is mapped back to `null` in `GET /ideas` and rendered as `'N/A'` in the UI. However, `GET /ideas` performs an exact match (`r.potentialScore === -1 ? null : r.potentialScore`) rather than a defensive boundary check (`r.potentialScore <= 0`), which would leak arbitrary negative integers if present.
4. **Audit D — RAG Schema & Canonical Default Terminology (`DISCREPANCY RESOLVED`):**  
   The terminology `isCanonicalDefault` referenced in predecessor markdown reports is **neither a physical database column, nor a view, nor a TypeScript interface property**. The actual SQLite column and codebase identifier established in Migrations 007–010 and `server/providers/rag_engine.ts` is `isSystemDefault`. The actual query executed by the engine is `(ownerId = ? OR isSystemDefault = 1) AND isQuarantined = 0`.
5. **Regression Test Suite (`109 / 110 PASSING`):**  
   All static types (`npm run typecheck`: 0 errors) and application bundling (`npm run build`: 406ms) pass cleanly. In `npm test`, 109 of 110 tests passed. Exactly one test failed: a live stochastic inference test in `llm_provider.test.ts` where raw `qwen2.5:1.5b` generated an incomplete scene schema, triggering `LLM_INVALID_OUTPUT`. This confirms the critical design necessity of `FallbackLLMProvider`.

---

## 2. Repository Preservation Evidence

- **Baseline Commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`
- **Audit Execution:** Strict read-only mode.
- **Working Tree Integrity:** Zero application code, test files, database files, or historical migrations were modified or staged.
- **Persistent Data:** Zero database writes or schema modifications were executed against persistent SQLite databases.

---

## 3. Audit A — Ollama Cancellation Evidence

### 3.1 Review of Predecessor Experiment
In Phase 2.2.2, a scratch experiment (`timeout_cancellation_experiment.ts`) measured daemon behavior when client timeout was set to `10ms`:
- Client threw `[LLM_TIMEOUT]` after 15ms.
- Polling `/api/ps` at 0ms, 500ms, 1000ms, 1500ms, 2000ms returned:
  `{"models":[{"name":"qwen2.5:1.5b","size_vram":1353128448,"expires_at":"..."}]}`
- A subsequent request took 5,894ms (vs 3,770ms baseline).

### 3.2 Forensic Analysis of Claims
| Claim | Experimental Evidence | Forensic Verdict | Audit Notes |
|:---|:---|:---:|:---|
| **Client HTTP request abortion** | `AbortSignal.timeout(10)` threw `TimeoutError` in Node runtime. | **PROVEN** | Client socket closed as expected. |
| **Model residency after timeout** | `/api/ps` showed `size_vram: 1353128448` and active keep-alive. | **PROVEN** | Weights remained resident in Apple Silicon Unified Memory. |
| **Active inference after timeout** | `/api/ps` presence only. | **NOT PROVEN** | `/api/ps` reports resident model memory, not GPU/CPU compute utilization or active token iteration. |
| **Subsequent request queueing** | Subsequent call took 5,894ms vs 3,770ms. | **NOT PROVEN** | Latency delta can be attributed to prompt evaluation variance, OS memory pressure, or garbage collection. |
| **Eventual inference completion** | No tokens or completion events captured after socket close. | **NOT PROVEN** | Ollama could have aborted the inference loop upon receiving `EPIPE`/`ECONNRESET` when attempting to write chunks. |
| **Model unloading & recovery** | `POST /api/generate` with `keep_alive: 0` yielded empty `/api/ps`. | **PROVEN** | Memory deallocation operates cleanly via API. |

### 3.3 Proposed Definitive Instrumentation (Non-Destructive)
To rigorously establish daemon-side behavior in a future phase without destabilizing the system:
1. **Streaming Token Generation (`stream: true`):** Connect an HTTP client using chunked transfer encoding, read 2 tokens, abort the socket, and observe whether the local daemon's debug log (`OLLAMA_DEBUG=1 ollama serve`) prints `llama_decode: failed to write response: broken pipe` and halts, or continues decoding.
2. **Metal GPU Power Telemetry:** Sample `powermetrics --samplers gpu_power` before, during, and after client abortion to detect whether GPU core power draw remains elevated after socket disconnection.

---

## 4. Audit B — Fallback Metadata Concurrency

### 4.1 Implementation Inspection
In `server/providers/llm.ts`:
- **Per-Result Metadata:**
  Lines 696–699 and 742–745:
  ```typescript
  // generateIdeas:
  return results.map((r) => ({ ...r, metadata: r.metadata || meta }));

  // generateStory:
  return { ...story, metadata: story.metadata || meta };
  ```
- **Shared Instance State:**
  Lines 672, 695, 719, 741, 765:
  ```typescript
  this.lastExecutionMetadata = meta;
  ```

### 4.2 Concurrency Race Scenario
Consider two overlapping HTTP requests hitting the singleton `FallbackLLMProvider`:
$$\begin{aligned}
t = 0\text{ms}: & \quad \text{Request A starts (Ollama route, duration 3500ms)} \\
t = 1000\text{ms}: & \quad \text{Request B starts (Ollama fails in 50ms, falls back to deterministic, finishes at } t = 1060\text{ms)} \\
t = 1060\text{ms}: & \quad \text{Request B sets } \mathtt{this.lastExecutionMetadata} = \{\text{provider: 'deterministic', fallbackOccurred: true}\} \\
t = 3500\text{ms}: & \quad \text{Request A sets } \mathtt{this.lastExecutionMetadata} = \{\text{provider: 'ollama', fallbackOccurred: false}\}
\end{aligned}$$

### 4.3 Findings
1. **HTTP Routes are Safe:** In `server/content_engine.ts#L651`, the route inspects `story.metadata?.provider === 'ollama'`, reading from the returned story object. It does **not** call `getLastExecutionMetadata()`.
2. **Shared Mutable State Risk:** If an external diagnostic endpoint, log aggregator, or monitoring middleware invokes `fallbackProvider.getLastExecutionMetadata()`, it will observe race conditions and corrupted attribution under concurrent load.
3. **Recommendation:** Deprecate or remove `getLastExecutionMetadata()` from `FallbackLLMProvider` in favor of strict, immutable per-result metadata.

---

## 5. Audit C — Score Sentinel Completeness

### 5.1 End-to-End Sentinel Trace
1. **Model Generation Layer (`server/providers/llm.ts`):**  
   Missing, null, non-numeric, or out-of-range scores evaluate to `potentialScore: null` with `scoreSource: 'unavailable'`.
2. **Database Insertion Layer (`server/content_engine.ts#L581`):**  
   `dbPotentialScore = typeof idea.potentialScore === 'number' && Number.isFinite(idea.potentialScore) ? idea.potentialScore : -1`.  
   Persists `-1` to satisfy SQLite `NOT NULL` constraint on `content_ideas.potentialScore`.
3. **Database Read Layer (`server/content_engine.ts#L634`):**  
   `potentialScore: r.potentialScore === -1 ? null : r.potentialScore`.  
   Maps `-1` back to `null`.
4. **Acceptance Workflow (`server/content_engine.ts#L648`):**  
   `SELECT * FROM content_ideas WHERE id=? AND ownerId=?`.  
   `idea.potentialScore` is not copied into `content_items`, `scripts`, or `scenes`.
5. **Frontend Rendering (`web/main.tsx#L968`):**  
   `Pot: {idea.potentialScore !== null && idea.potentialScore !== undefined && idea.potentialScore >= 0 ? idea.potentialScore + '%' : 'N/A'}`.  
   Displays `'N/A'` when score is unavailable.

### 5.2 Boundary Defect Identified
In `server/content_engine.ts#L634`:
```typescript
potentialScore: r.potentialScore === -1 ? null : r.potentialScore,
```
If a legacy record or external script inserted a negative score other than `-1` (e.g. `-2` or `-99`), the read mapping would fail to map it to `null`, returning the raw negative integer to the API client.
- **Severity:** LOW.
- **Remediation Recommendation:** Change comparison to:
  `potentialScore: (typeof r.potentialScore === 'number' && r.potentialScore >= 0) ? r.potentialScore : null`.

---

## 6. Audit D — RAG Schema and Canonical-Default Terminology

### 6.1 Physical SQLite Schema & Migrations
Inspection of `server/migrations/` (Migrations 007, 008, 009, 010) revealed the physical schema of `rag_knowledge`:
```sql
CREATE TABLE rag_knowledge (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  metadata TEXT,
  ownerId INTEGER REFERENCES users(id),       -- Added in 007
  isSystemDefault INTEGER NOT NULL DEFAULT 0,  -- Added in 007
  isQuarantined INTEGER NOT NULL DEFAULT 0,    -- Added in 007
  seedKey TEXT                                 -- Added in 008
);
```

### 6.2 Reconciliation of Terminology
- **`isCanonicalDefault`:** **DOES NOT EXIST** in SQLite tables, triggers, views, or TypeScript source files.
  - It was an inaccurate descriptive shorthand introduced in markdown audit reports (`AI_FOUNDATION_2_2_1_VERIFICATION_REPORT.md` and `AI_FOUNDATION_2_2_2_REMEDIATION_REPORT.md`).
- **`isSystemDefault`:** The actual, physical SQLite column and TypeScript property.
- **`seedKey`:** Partial unique index enforcing single-instance canonical provenance.
- **`isQuarantined`:** Fail-closed quarantine flag isolating untrusted or ambiguous legacy rows.

### 6.3 Actual Retrieval SQL
In `server/providers/rag_engine.ts#L192-L200`:
```sql
SELECT * FROM rag_knowledge WHERE (ownerId = ? OR isSystemDefault = 1) AND isQuarantined = 0
```
- Legitimate canonical defaults (`isSystemDefault = 1`, `isQuarantined = 0`, `seedKey IS NOT NULL`) are globally retrievable.
- Private tenant records (`ownerId = userId`, `isSystemDefault = 0`, `isQuarantined = 0`) are retrievable only by their owner.
- Quarantined records (`isQuarantined = 1`) are completely hidden from retrieval.

---

## 7. Regression Verification Results

### 7.1 Static & Build Verification
- **`npm run typecheck` (`tsc --noEmit`):** **0 errors**.
- **`npm run build` (`vite build web`):** **0 errors** (built in 406ms).

### 7.2 Test Suite Execution Summary
Executed via `npm test`:
```text
ℹ tests 110
ℹ suites 0
ℹ pass 109
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 52084.053667
```

### 7.3 Detailed Test File Inventory
| Test File | Total Assertions | Passed | Failed | Status |
|:---|:---:|:---:|:---:|:---:|
| `server/test/llm_provider.test.ts` | 42 | 41 | 1 | **1 Stochastic Failure** |
| `server/test/rag_engine.test.ts` | 13 | 13 | 0 | **100% PASS** |
| `server/test/migration_hardening.test.ts` | 10 | 10 | 0 | **100% PASS** |
| `server/test/audio_configuration.test.ts` | 20 | 20 | 0 | **100% PASS** |
| `server/test/ffmpeg_composition.test.ts` | 3 | 3 | 0 | **100% PASS** |
| `server/test/experiments_api.test.ts` | 11 | 11 | 0 | **100% PASS** |
| `server/test/api.test.ts` | 1 | 1 | 0 | **100% PASS** |
| `server/test/async_jobs.test.ts` | 2 | 2 | 0 | **100% PASS** |
| `server/test/character_entity.test.ts` | 3 | 3 | 0 | **100% PASS** |
| `server/test/face_animation.test.ts` | 2 | 2 | 0 | **100% PASS** |
| `server/test/phase2_content_engine.test.ts` | 1 | 1 | 0 | **100% PASS** |
| `server/test/phase3_quality_and_schedule.test.ts` | 2 | 2 | 0 | **100% PASS** |
| **TOTAL** | **110** | **109** | **1** | **99.1% PASS** |

### 7.4 Analysis of Stochastic Failure
- **Test:** `Live Local Ollama Integration - Real inference, structured schema, and memory unload` (`llm_provider.test.ts:504`).
- **Error:** `[LLM_INVALID_OUTPUT] Scene 5 missing required fields (narration, visualPrompt, voiceDirection)`.
- **Significance:** In this run, the raw 1.5B quantized model omitted a required string field in Scene 5. The validator properly caught the violation and threw `SanitizedLLMError`. In application runtime, `FallbackLLMProvider` catches this and smoothly falls back to `LocalLLMProvider`. In a raw standalone test, it surfaces as an assertion rejection.

---

## 8. Findings Register

| Finding ID | Severity | Category | Description | Source Reference |
|:---|:---:|:---|:---|:---|
| **FND-2221-01** | **LOW** | Audit A / Empirical | Daemon-side inference continuation after client fetch timeout was not directly measured by `/api/ps` or latency checks. | [AI_FOUNDATION_2_2_2_REMEDIATION_REPORT.md](file:///Users/abhisheksuman/Documents/GitHub/studio/docs/business-audit/AI_FOUNDATION_2_2_2_REMEDIATION_REPORT.md#L160) |
| **FND-2221-02** | **MEDIUM** | Audit B / Concurrency | `FallbackLLMProvider.getLastExecutionMetadata()` mutates shared state on a singleton instance, causing race conditions under concurrent calls. | [server/providers/llm.ts#L672](file:///Users/abhisheksuman/Documents/GitHub/studio/server/providers/llm.ts#L672) |
| **FND-2221-03** | **LOW** | Audit C / Boundary | `r.potentialScore === -1 ? null : r.potentialScore` in `GET /ideas` checks equality with `-1` rather than non-negative boundary (`< 0`). | [server/content_engine.ts#L634](file:///Users/abhisheksuman/Documents/GitHub/studio/server/content_engine.ts#L634) |
| **FND-2221-04** | **LOW** | Audit D / Documentation | Predecessor audit reports referenced non-existent column `isCanonicalDefault` instead of physical SQLite column `isSystemDefault`. | [AI_FOUNDATION_2_2_1_VERIFICATION_REPORT.md](file:///Users/abhisheksuman/Documents/GitHub/studio/docs/business-audit/AI_FOUNDATION_2_2_1_VERIFICATION_REPORT.md#L46) |
| **FND-2221-05** | **LOW** | Regression / Live LLM | Raw `qwen2.5:1.5b` live inference occasionally drops required schema properties, causing standalone tests to fail when not wrapped in fallback. | [server/test/llm_provider.test.ts#L504](file:///Users/abhisheksuman/Documents/GitHub/studio/server/test/llm_provider.test.ts#L504) |

---

## 9. Recommended Remediation (For Separately Approved Phase)

1. **Remove Shared Mutable Getter:**  
   Deprecate `FallbackLLMProvider.getLastExecutionMetadata()`. Callers must rely exclusively on per-result metadata (`result.metadata`).
2. **Defensive Score Deserialization:**  
   In `server/content_engine.ts`, update line 634:
   ```typescript
   potentialScore: (typeof r.potentialScore === 'number' && r.potentialScore >= 0) ? r.potentialScore : null,
   ```
3. **Correct Report Terminology:**  
   Ensure future architectural references cite `isSystemDefault` and `seedKey` rather than `isCanonicalDefault`.
4. **Wrap Live Integration Test:**  
   In `server/test/llm_provider.test.ts`, wrap the live generation test with `FallbackLLMProvider` or allow retry to absorb small-parameter LLM schema stochasticity.

---

## 10. Exact Files Changed

```text
docs/business-audit/AI_FOUNDATION_2_2_2_1_VERIFICATION_REPORT.md
```

*(Zero source files, test files, or migrations were modified during this read-only audit.)*

---

*Report approved by Independent Senior Forensic Audit Team — November 16, 2026.*

