# Auravo Studio — Phase 2C.0.3: Residual Security, Evidence & Licence Verification Audit Report

**Document ID:** `AURAVO-P2C0.3-RESIDUAL-AUDIT-20261115`  
**Date:** November 15, 2026  
**Mode:** READ-ONLY FORENSIC AUDIT  
**Starting Verdict:** Phase 2C.0.2 reports `PHASE_2C0_2_SECURITY_REMEDIATION_COMPLETE`  
**Final Audit Verdict:** `PHASE_2C0_3_VERIFIED_WITH_LIMITATIONS`  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Commit Baseline:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`

---

## 1. Executive Verdict & Summary

An independent, read-only forensic audit of the Phase 2C.0.2 security remediations and evidence integrity was conducted on the Auravo Studio codebase.

The final audit verdict is **`PHASE_2C0_3_VERIFIED_WITH_LIMITATIONS`**.

### Core Verdict Rationale
1. **Critical Security Fixes Verified:** The primary vulnerabilities identified in Phase 2C.0.1 (unauthenticated API routing bypass, unscoped global job queries across tenants, unauthenticated frontend live-job polling, and unrestricted `.json` telemetry streaming) were successfully remediated and verified through automated regression testing.
2. **Residual Security Limitation Identified:** The live-jobs endpoint sanitizes query execution failures, but returns **raw persisted `jobs.error` strings** from the database. When background pipeline operations fail (such as FFmpeg composition or file system operations), raw error messages can leak local host paths (`/Users/abhisheksuman/...`) or provider execution traces to the authenticated user.
3. **Licence Registry Discrepancy Identified:** Stability AI's `stabilityai/stable-diffusion-xl-base-1.0` was released upstream on July 26, 2023 under the **`CreativeML Open RAIL++-M`** license, matching ByteDance's `SDXL-Lightning` derivative. The Auravo model registry retains a reference to `Stability AI Open Model License 0.9.0` (which was the research pre-release license for SDXL 0.9).
4. **Test Suite Accounting Reconciled:** The reported "8 API tests" in Phase 2C.0.2 reflects 1 top-level test block containing 7 subtests reported by the Node.js test runner. While authentication, tenant isolation, JSON blocking, and encoded traversal are strictly verified, **a dedicated symlink-escape regression test and stored error string sanitization test do not currently exist**.
5. **Zero Monetary Expenditure Confirmed:** \$0.00 spent, 0 models downloaded, 0 dependencies modified.

---

## 2. Source Files and Exact Functions Inspected

The following source files, database schemas, and migration scripts were audited line by line:

1. **`server/app.ts`**:
   - `auth` middleware (lines 32–37): Cookie parsing (`sid`), session token hashing (`hash(t)`), and database lookup.
   - Route mounting (lines 59–80): Verification that `api.use('/experiments', createExperimentsRouter(db))` and `api.use('/', createJobsRouter(db))` are mounted inside `api` router protected by `api.use(auth)`.
2. **`server/experiments.ts`**:
   - `GET /live-jobs` (lines 998–1015): Authentication verification via `uid(req)`, query scoping `WHERE ownerId = ?`, and error handling.
   - `GET /artifact/:phase/:file` (lines 1017–1075): Regex extension enforcement, `APPROVED_ARTIFACTS` allowlist matching, `lstatSync` symlink check, `realpathSync` containment verification.
   - Historical experiment entries and benchmarks (lines 603–924).
3. **`server/jobs.ts`**:
   - `JobManager.createJob` (lines 53–78): Insertion into SQLite `jobs` table with `ownerId`.
   - `JobManager.updateProgress` (lines 88–125): Progress and error persistence with `WHERE id=? AND ownerId=?`.
   - `JobManager.startRenderPipelineAsync` (lines 142–394): Background execution, exception catching, and `error: err.message` persistence.
   - `createJobsRouter` (lines 397–467): `/jobs`, `/jobs/:id`, `/jobs/:id` DELETE, `/content/:id/render-async`.
4. **`server/crud.ts`**:
   - `uid` helper function (line 6): `(req as Request & { userId: number }).userId`.
5. **`server/migrations/004_phase4_async_jobs.sql`**:
   - Table schema definition for `jobs` table: `ownerId INTEGER NOT NULL REFERENCES users(id)`.
6. **`server/providers/face_animator.ts`**:
   - `LivePortraitFaceAnimatorProvider.animateFace` (lines 24–67): Dispatching to external GPU worker if URL configured, with local fallback.
   - `LivePortraitFaceAnimatorProvider.renderLocalFacialMotion` (lines 141–187): Eye-line anchored FFmpeg `zoompan` procedural camera motion.
7. **`web/main.tsx`**:
   - Unauthenticated rendering view (lines 4219–4226): Verification that public preview and background polling are removed.
   - ScriptStudio reference video upload UI (lines 1900–1920): Verification that file input is disabled with warning badge.
8. **`web/experiments_views.tsx`**:
   - `GenerationMonitorView` and variation cards (lines 1550–1650): Verification of run/criteria mapping and status badges.
9. **`server/test/experiments_api.test.ts`**:
   - Subtest definitions and assertions (lines 1–177).

---

## 3. Database Schema and Tenant Ownership Findings

### 3.1 Authenticated User ID Origin
- In [server/app.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/app.ts#L32-L37), `auth` middleware inspects `req.headers.cookie` for `sid=<token>`.
- The token is hashed with SHA-256 (`crypto.createHash('sha256').update(t).digest('hex')`).
- The session is validated against the SQLite database:
  ```sql
  SELECT userId FROM sessions WHERE tokenHash = ? AND expiresAt > ?
  ```
- If valid, `(req as any).userId` is populated with the database integer `userId`.
- If invalid or missing, `auth` terminates the request with `401 Unauthorized` without calling `next()`.

### 3.2 Caller-Control and Missing `uid(req)` Protection
- `uid(req)` in [server/crud.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/crud.ts#L6) reads `(req as any).userId`.
- Because `/api/experiments` is mounted on `api` (which has `api.use(auth)`), `uid(req)` **cannot be spoofed, supplied by query parameters, or caller-controlled**.
- If a route were accidentally mounted outside `auth`, `uid(req)` would return `undefined`. In `better-sqlite3`, binding `undefined` immediately throws a `TypeError: Bind parameters must not contain undefined`, preventing execution.

### 3.3 Schema Ownership Enforcement
- In `server/migrations/004_phase4_async_jobs.sql`, the schema specifies:
  ```sql
  CREATE TABLE IF NOT EXISTS jobs(
    id TEXT PRIMARY KEY,
    ownerId INTEGER NOT NULL REFERENCES users(id),
    ...
  );
  ```
- The `NOT NULL` constraint and foreign key constraint guarantee that no job row can exist in the database without an owner.

### 3.4 Job Creation, Updates, and Asynchronous Execution
- **Creation:** `JobManager.createJob` requires `ownerId: number` and executes:
  `INSERT INTO jobs (id, ownerId, ...) VALUES (?, ?, ...)`.
  In `server/jobs.ts:444`, `ownerId` is populated strictly from `userId = uid(req)`.
- **Updates:** `JobManager.updateProgress` enforces `WHERE id=? AND ownerId=?` on every update, ensuring one user cannot modify another user's job status or progress.
- **Asynchronous Execution:** `startRenderPipelineAsync` receives `ownerId` directly as an explicit parameter and scopes all asset lookups (`WHERE id=? AND ownerId=?`) and updates to that owner.
- **Query Scoping:** Both `server/jobs.ts` (`listJobs`) and `server/experiments.ts` (`GET /live-jobs`) filter strictly by `WHERE ownerId = ?`.
- **Test Evidence:** [server/test/experiments_api.test.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/test/experiments_api.test.ts#L112-L154) creates separate jobs for User A and User B and verifies that querying User A returns strictly `job-user-a` and User B returns strictly `job-user-b`.

---

## 4. Security Findings & Live-Job Error Sanitization Analysis

### 4.1 Persisted Job Error Sanitization Discrepancy
In [server/experiments.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/experiments.ts#L1005):
```typescript
const jobs = db.prepare('SELECT id, type, status, progress, currentStage, error, createdAt, updatedAt FROM jobs WHERE ownerId = ? ORDER BY createdAt DESC LIMIT 20').all(userId);
```
- **Query-Failure Sanitization:** If the SQLite query itself fails, the endpoint catches the exception and returns `{ error: 'Failed to query jobs table' }` (line 1013), successfully sanitizing internal database error messages.
- **Persisted Error Value Exposure:** If a job fails during background execution, `JobManager.startRenderPipelineAsync` catches the error and persists it:
  ```typescript
  // server/jobs.ts:387-391
  this.updateProgress(jobId, ownerId, {
    status: 'FAILED',
    currentStage: 'Job failed during execution',
    error: err.message || 'Unknown pipeline execution failure',
  });
  ```
  `err.message` can contain:
  1. **FFmpeg process stderr**: E.g. `/Users/abhisheksuman/Documents/GitHub/studio/data/storage/videos/short_123_master.mp4: No such file or directory`.
  2. **Filesystem errors**: E.g. `ENOENT: no such file or directory, open '/Users/abhisheksuman/...'`.
  3. **Third-party / worker traces**: Connection strings, local port numbers, or stack fragments.

Because `job.error` is sent directly to the client inside the `jobs` array, **the live-jobs endpoint does not sanitize persisted error strings before returning them**.

### 4.2 Proposed Safe Response Contract
To eliminate residual information disclosure while keeping error states diagnosable for users, the live-jobs endpoint should enforce this contract:

```typescript
export interface SanitizedJobResponse {
  id: string;
  type: string;
  status: 'QUEUED' | 'INITIALIZING' | 'GENERATING_CHARACTER' | 'ANIMATING_FACE' | 'GENERATING_MOTION' | 'SYNTHESIZING_VOICE' | 'RENDERING_MASTER' | 'QUALITY_CHECK' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  currentStage: string | null;
  error: string | null; // Sanitized: High-level classification (e.g. 'RENDERING_FAILED', 'STORAGE_ERROR'), with all local absolute paths (/Users/...) and stack traces stripped
  createdAt: string;
  updatedAt: string;
}
```

*Implementation rule: Apply a regex sanitizer `error ? error.replace(/\/Users\/[^\s:'"]+/g, '[REDACTED_PATH]').slice(0, 200) : null` or map to generic error categories.*

### 4.3 Artifact Filesystem Security Audit
In [server/experiments.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/experiments.ts#L1017-L1075):
- **Allowlist Enforcement:** `APPROVED_ARTIFACTS` contains exactly 10 approved relative paths.
- **Phase & Filename Validation:** Both `relKeySub` (`${phase}/outputs/${file}`) and `relKeyRoot` (`${phase}/${file}`) must match an entry in `APPROVED_ARTIFACTS`.
- **Extension Restriction:** Only `.(png|jpg)` are accepted. Requests for `.json` telemetry or logs are rejected with `400 Bad Request`.
- **Symlink & Canonical Path Checking:**
  - `fs.lstatSync(cand).isSymbolicLink()` checks the candidate leaf.
  - `fs.realpathSync(cand).startsWith(realBase + path.sep)` verifies that the resolved realpath is strictly within the local model storage directory.
- **TOCTOU Observation:** A theoretical time-of-check to time-of-use race exists because validation occurs via `fs.realpathSync(cand)` and streaming occurs via `fs.createReadStream(targetPath)`. In this single-user local environment where web callers cannot create files in `~/.local/share/auravo/models`, the exploitability is effectively zero, but opening by file descriptor (`O_NOFOLLOW`) is recommended for production hardening.
- **Symlink Test Coverage:** `server/test/experiments_api.test.ts` tests path traversal (`..%2f`) and unapproved files, but **does not create a physical symlink pointing outside `baseDir` to test symlink rejection**.

---

## 5. Model Licence Registry Accuracy Audit

A detailed comparison between the upstream license files in the local cache, repository audit documents, and the Auravo registry was conducted:

| Model Component | Upstream Model Repository | Actual Upstream Licence File / Evidence | Current Auravo Registry Entry | Status & Discrepancy |
|---|---|---|---|---|
| **SDXL Base 1.0 (Base Weights)** | `stabilityai/stable-diffusion-xl-base-1.0` | **`CreativeML Open RAIL++-M License`** (Dated July 26, 2023) | `Stability AI Open Model License 0.9.0` | **DISCREPANCY DETECTED:** Clerical error. SDXL Base 1.0 was released under Open RAIL++-M. Stability AI Open Model License 0.9.0 applied only to the pre-release SDXL 0.9 research preview. |
| **SDXL-Lightning (4-step UNet)** | `ByteDance/SDXL-Lightning` | **`CreativeML Open RAIL++-M License`** (Dated July 26, 2023; Copyright 2024 ByteDance, 2023 Stability AI) | `CreativeML Open RAIL++-M` | **ACCURATE:** Reconciled in Phase 2C.0.2. Matches physical upstream `LICENSE.md` in model cache. |
| **OpenCLIP ViT-H/14 (IP-Adapter Vision Encoder)** | `laion/CLIP-ViT-H-14-laion2B-s32B-b79K` | MIT License (Model Code); **LAION-2B Pretraining Data** | Under Legal Hold | **ACCURATE:** Commercial legal hold remains active due to LAION-2B training data copyright considerations. Not downloaded. |

### Commercial Impact of SDXL Base Licence Reconciliation
- The `CreativeML Open RAIL++-M License` permits commercial deployment and hosting (Section III: *"You may host for Third Party remote access purposes (e.g. software-as-a-service)"*), subject only to the ethical use restrictions in Attachment A (prohibiting illegal, defamatory, and harmful content).
- Reconciling the registry from `Stability AI Open Model License 0.9.0` to `CreativeML Open RAIL++-M` eliminates confusion regarding non-commercial research clauses that applied to the earlier 0.9 preview.
- Formal commercial clearance remains subject to counsel sign-off.

---

## 6. Experiment History & Evidence Linkage Verification

The six variation criteria presented in the Generation Monitor were audited against their source generation runs:

```
[Phase 2B.5.3 Single Run (seed=202, strength=0.50)]
  ├── Wardrobe Change Criteria ──> Status: BLOCKED (95% old tan halter crop top retained)
  ├── Background Scene Criteria ─> Status: BLOCKED (0% outdoor terrace generated; flat studio wall locked)
  └── Lighting Shift Criteria ───> Status: DEMONSTRATED_WITH_LIMITATIONS (Red channel warmed +130.22, but directional rim lighting locked)

[Phase 2B.4B Single Run (seed=202, 63-token condensed prompt)]
  ├── Camera Angle Criteria ─────> Status: DEMONSTRATED_WITH_LIMITATIONS (Centered headshot achieved; locked to seed 202)
  └── Pose / Defect Criteria ────> Status: DEMONSTRATED_WITH_LIMITATIONS (Frame removed; hands excluded by bust framing, anatomy NOT solved)

[Phase 1C Automated FFmpeg Suite (Procedural Composition)]
  └── Video Scene Criteria ──────> Status: DEMONSTRATED (5-beat composition; procedural Ken Burns camera glide over static portrait)
```

### Forensic Evidence Assessment
1. **Lighting Shift (Phase 2B.5.3):** The model warmed the pixel channel intensities (mean red channel shifted from 112 to 130.22), giving the image a warmer tone. However, directional sunset rim lighting, golden-hour outdoor highlights, and sky scattering completely failed to materialize due to source specular highlight lock-in. Labeled as `DEMONSTRATED_WITH_LIMITATIONS`.
2. **Wardrobe & Scene Replacement (Phase 2B.5.3):** Accurately marked as `BLOCKED` (or `FAILED` in UI context). Denoising at $s=0.50$ cannot dissolve high-contrast boundaries of existing garments or backgrounds.
3. **Pose & Framing (Phase 2B.4B):** Accurately labeled with limitations. Bust framing excludes hands from the frame; this does **not** prove that hand anatomy or limb generation was solved.
4. **Video Scene Consistency (Phase 1C):** Accurately labeled. Facial consistency across beats is guaranteed because the identical master still portrait is reused with 2D camera translation. This is **not neural character animation**.

---

## 7. Motion Capability Classification Audit

Inspection of [server/providers/face_animator.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/providers/face_animator.ts#L141-L187) confirmed:

```typescript
// server/providers/face_animator.ts:152-157
const filterComplex = [
  'scale=2160:3840:force_original_aspect_ratio=increase',
  'crop=2160:3840',
  "zoompan=z='min(zoom+0.0006,1.16)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*0.25':d=1:s=1080x1920:fps=30",
  'format=yuv420p',
].join(',');
```

1. **Local Mode Classification:** The local implementation is **`CAMERA_MOTION_ONLY`**. The character's face and body are not deformed or animated by neural networks locally.
2. **Neural Face Warping:** LivePortrait neural deformation executes **only if a remote GPU worker URL is provided** (`process.env.AI_WORKER_URL` or `process.env.NEURAL_DANCE_GPU_URL`). If absent, it falls back to the FFmpeg `zoompan` camera glide above.
3. **Neural Dance Diffusion & Video Generation:** Marked as `NOT_IMPLEMENTED` on local hardware ($0 cost policy).
4. **Reference Video Upload Safeguards:**
   - In `web/main.tsx`, the local video file upload input is disabled with: `⚠️ Reference video upload is temporarily disabled pending consent, provenance verification, and pose-only processing safeguards.`
   - In `server/content_engine.ts`, the backend endpoint `POST /content/:id/attach-dance-reference` still accepts `youtubeUrl`, `videoUrl`, and `videoBase64` payloads for beat extraction. Future phases must apply server-side gate checks to block base64 upload requests at the API layer.

---

## 8. Test Suite Reconciliation

### Discrepancy Resolution
In the Phase 2C.0.2 report, the API test suite was described as passing "8/8 tests" while listing 7 subtest names.

**Audit Finding:** The Node.js native test runner (`node:test`) counts the top-level parent `test(...)` block as 1 test and each nested `t.test(...)` as 1 test:
- 1 Parent Suite: `Experiments API - Authentication, Tenant Isolation & Evidence Security`
- 7 Subtests:
  1. `Unauthenticated requests to /api/experiments are rejected with 401`
  2. `Unauthenticated requests to /api/experiments/live-jobs are rejected with 401`
  3. `Authenticated GET /api/experiments returns full metadata with harmonized vocabulary`
  4. `GET /api/experiments/live-jobs enforces tenant isolation across users`
  5. `GET /api/experiments/artifact/:phase/:file streams approved PNG`
  6. `GET /api/experiments/artifact/:phase/:file strictly blocks JSON files (telemetry protection)`
  7. `GET /api/experiments/artifact/:phase/:file rejects path traversal and unapproved files`
- **Total Reported by Runner:** $1 + 7 = 8\text{ tests}$.

### Detailed Test Coverage Matrix

| Security / Integrity Requirement | Covered in Test Suite? | Verification Evidence |
|---|---|---|
| Unauthenticated Access Rejection (401) | **YES** | Lines 42–52 assert 401 on `/api/experiments` and `/api/experiments/live-jobs` |
| Cross-User Tenant Isolation | **YES** | Lines 112–154 insert distinct jobs for User A and User B; verifies zero cross-tenant leakage |
| Encoded Directory Traversal Block | **YES** | Lines 170–173 test `..%2f..%2fetc%2fpasswd.png` returning 400 |
| JSON / Telemetry Blocking | **YES** | Lines 164–168 test `telemetry.json` returning 400 |
| Missing Ownership Fails Closed | **YES** | Covered by `auth` middleware (returns 401) and SQLite `NOT NULL` schema constraint |
| **Stored Job Error Sanitization** | **NO** | Test suite does not test a failed job containing host paths or verify path redaction |
| **Dedicated Symlink-Escape Test** | **NO** | Test suite does not create a physical symlink pointing outside `baseDir` to test `lstatSync` rejection |

---

## 9. Remaining Risks & Recommended Remediations

To progress to full production readiness, the following non-blocking improvements are recommended:

1. **Job Error Redaction:** In `server/experiments.ts`, sanitize `job.error` by replacing local filesystem paths (`/Users/...`) with generic tokens before returning live jobs to clients.
2. **SDXL Base Licence Citation:** Update the `licenceAssessment` fields in `server/experiments.ts` from `Stability AI Open Model License 0.9.0` to `CreativeML Open RAIL++-M` to align with upstream release metadata.
3. **Dedicated Symlink Escape Regression Test:** Add a test case in `server/test/experiments_api.test.ts` that creates a temporary symlink pointing to `/etc/hosts` and verifies that the artifact route rejects it with `400 Bad Request`.
4. **Backend Dance Upload Safeguard:** In `server/content_engine.ts`, reject `videoBase64` uploads on `POST /content/:id/attach-dance-reference` until consent and pose extraction validation are finalized.

---

## 10. Initial & Final Git Status

- **Initial HEAD Commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`
- **Initial Working Tree:** Modified Phase 2C.0.2 files present unstaged.
- **Final Working Tree:** Exactly identical to initial state, with the addition of this audit report and the external JSON evidence record.
- **Git Commits Executed:** 0 (Zero git commit, reset, or branch operations).

---

## 11. Mandatory Policy Compliance Statement

This forensic audit strictly complied with all project constraints:
- **Source code changes:** None.
- **Dependency changes / installations:** None.
- **Model downloads:** 0 bytes.
- **Database mutations:** None.
- **Monetary expenditure:** \$0.00.

**AUDIT COMPLETE. STOPPING FOR USER REVIEW.**

