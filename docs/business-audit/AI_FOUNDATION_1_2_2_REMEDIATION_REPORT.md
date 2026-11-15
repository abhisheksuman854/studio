# Auravo Studio — AI-Foundation 1.2.2: RAG Migration Provenance Repair & Real-Runner Verification Report

**Document ID:** `AURAVO-AIF1.2.2-REMEDIATION-20261116`  
**Phase:** AI-Foundation 1.2.2  
**Date:** November 16, 2026  
**Mode:** Controlled implementation with isolated test databases  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Branch:** `main`  
**Baseline Commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`  
**Previous Audit Finding:** `AI_FOUNDATION_1_2_SECURITY_BLOCKED` (`AURAVO-AIF1.2.1-VERIFICATION-20261116`)  
**Final Status Verdict:** **`AI_FOUNDATION_1_2_2_COMPLETE`**

---

## 1. Executive Summary & Verdict

This phase completely remediates the migration provenance security defect identified in **AI-Foundation 1.2.1**.

Migration 007 previously contained a title-based `UPDATE` that promoted legacy records to globally visible system defaults because SQLite's `ALTER TABLE ... ADD COLUMN ownerId` initialized all pre-existing rows to `NULL`, making `AND (ownerId IS NULL)` match 100% of legacy records. Furthermore, the previous test suite in `migration_hardening.test.ts` masked this defect by manually patching `ownerId` between migrations.

In AI-Foundation 1.2.2:
1. **Title-Based Legacy Promotion Fully Eliminated:** Migration 007 now strictly adds columns and fails closed by quarantining all legacy unverified rows (`isQuarantined = 1, isSystemDefault = 0`). Zero legacy rows are promoted to system defaults based on title.
2. **Canonical Insertion via Stable `seedKey`s:** Migration 008 independently inserts the 12 verified application-owned defaults directly with immutable `seedKey`s and `isSystemDefault = 1, ownerId = NULL, isQuarantined = 0`. It does **not** reclassify or mutate pre-existing legacy rows into defaults based on string matching.
3. **De-Promotion of Unverified Defaults:** Migration 008 de-promotes and quarantines any row previously marked `isSystemDefault = 1` that lacks an application-owned `seedKey`.
4. **Real `openDb()` Runner Execution:** Completely eliminated the test artifice. All test suites execute through the real production `openDb()` runner loop, verifying legacy upgrades from schema 006, post-007 existing databases with user collisions, clean empty databases, and real multi-statement failure/rollback/recovery.
5. **Recovery Guide Corrected:** Updated `AI_FOUNDATION_1_2_MIGRATION_AND_RECOVERY_GUIDE.md` to remove content-matching claims, correct WAL sidecar restore instructions, and document state classifications.

All 55 automated tests across all 12 test suites pass cleanly. TypeScript compilation and frontend production build succeed with zero errors.

The final verdict is **`AI_FOUNDATION_1_2_2_COMPLETE`**.

---

## 2. Root Cause Analysis of the AI-Foundation 1.2 Security Defect

### 2.1 The Tautological `ownerId IS NULL` Trap
In Migration 007 (`server/migrations/007_rag_tenant_isolation.sql`), lines 5 and 10–25 previously executed:
```sql
ALTER TABLE rag_knowledge ADD COLUMN ownerId INTEGER REFERENCES users(id);
...
UPDATE rag_knowledge
SET isSystemDefault = 1, ownerId = NULL, isQuarantined = 0
WHERE title IN ('Alapadma Mudra (Blooming Lotus)', ...) AND (ownerId IS NULL);
```
- When `ALTER TABLE` adds `ownerId` to an existing table, SQLite populates `ownerId = NULL` for all existing rows.
- The filter `AND (ownerId IS NULL)` evaluated to `TRUE` for every single pre-existing row in the table.
- Any legacy private record whose title matched any of the 12 canonical titles was promoted to `isSystemDefault = 1`, stripped of ownership, and exposed across all tenants.

### 2.2 The Test Fixture Artifice
In the previous test `server/test/migration_hardening.test.ts:60-61`, the test ran Migration 007, and then **manually patched**:
```typescript
db.prepare('UPDATE rag_knowledge SET ownerId = 101, isSystemDefault = 0 WHERE id = 1').run();
db.prepare('UPDATE rag_knowledge SET ownerId = 102, isSystemDefault = 0 WHERE id = 2').run();
```
This artificial manual intervention masked the fact that in a real sequential migration, `ownerId` was `NULL` and `isSystemDefault` was `1`.

---

## 3. Migration Strategy & Compatibility Architecture

### 3.1 Principles Enforced
1. **No Content-Based Ownership Inference:** System provenance is **never** inferred from titles, categories, contents, or `ownerId IS NULL`.
2. **Canonical Insertion Over Reclassification:** Rather than mutating historical rows, canonical defaults are inserted directly with immutable, unique `seedKey`s.
3. **Fail Closed:** Any legacy row with unknown provenance is quarantined (`isQuarantined = 1, isSystemDefault = 0`). Its original ID, title, content, tags, and metadata are 100% preserved.
4. **Collision Coexistence:** If a user authors a private record sharing a canonical title (e.g. `"Alapadma Mudra (Blooming Lotus)"`), the user's row remains private (`ownerId = user.id, isSystemDefault = 0`), while the canonical default exists independently (`ownerId = NULL, isSystemDefault = 1, seedKey = 'canonical_v1_alapadma_mudra'`).

### 3.2 SQL Behavior: Before vs. After

#### Migration 007 (`server/migrations/007_rag_tenant_isolation.sql`)
- **Before:**
  ```sql
  UPDATE rag_knowledge
  SET isSystemDefault = 1, ownerId = NULL, isQuarantined = 0
  WHERE title IN (...) AND (ownerId IS NULL);
  ```
- **After:**
  ```sql
  -- Fail-closed: all legacy records lacking verified provenance are quarantined.
  -- No legacy record is ever promoted to a system default based on title.
  UPDATE rag_knowledge
  SET isQuarantined = 1, isSystemDefault = 0
  WHERE isSystemDefault = 0;
  ```

#### Migration 008 (`server/migrations/008_rag_provenance_hardening.sql`)
- **Before:** Attempted `UPDATE rag_knowledge SET seedKey = ... WHERE category = ... AND title = ... AND content = ... AND ownerId IS NULL;` (which reclassified legacy rows based on string matching).
- **After:**
  ```sql
  -- 1. Unique index on seedKey
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_seed_key ON rag_knowledge(seedKey) WHERE seedKey IS NOT NULL;

  -- 2. De-promote any unverified records previously marked system defaults by old 007
  UPDATE rag_knowledge SET isSystemDefault = 0 WHERE isSystemDefault = 1 AND seedKey IS NULL AND ownerId IS NOT NULL;
  UPDATE rag_knowledge SET isSystemDefault = 0, isQuarantined = 1 WHERE isSystemDefault = 1 AND seedKey IS NULL AND ownerId IS NULL;

  -- 3. Insert canonical application-owned defaults directly with immutable seedKeys
  INSERT OR IGNORE INTO rag_knowledge (seedKey, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
  VALUES ('canonical_v1_alapadma_mudra', ...), ...;

  -- 4. Fail-closed: non-canonical rows with unknown ownership remain quarantined
  UPDATE rag_knowledge SET isQuarantined = 1, isSystemDefault = 0 WHERE seedKey IS NULL AND ownerId IS NULL;
  ```

---

## 4. Files Modified & Created

| File Path | Modification Summary |
|---|---|
| [server/migrations/007_rag_tenant_isolation.sql](file:///Users/abhisheksuman/Documents/GitHub/studio/server/migrations/007_rag_tenant_isolation.sql) | Removed title-based promotion entirely. Replaced with fail-closed quarantine of legacy rows. |
| [server/migrations/008_rag_provenance_hardening.sql](file:///Users/abhisheksuman/Documents/GitHub/studio/server/migrations/008_rag_provenance_hardening.sql) | Replaced content-matching `UPDATE`s with direct `INSERT OR IGNORE` of canonical seeds with `seedKey`. De-promotes unverified system defaults. |
| [server/db.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/db.ts) | Added optional `migrationsDir` parameter to `openDb(file, migrationsDir)` to support real runner failure testing on temporary fixture directories. |
| [server/test/migration_hardening.test.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/test/migration_hardening.test.ts) | Rewrote test suite to execute the real production `openDb()` runner. Removed all intermediate manual patches. Added pre-007 upgrade, post-007 existing DB, empty DB, runner failure/rollback, and HTTP isolation suites. |
| [docs/business-audit/AI_FOUNDATION_1_2_MIGRATION_AND_RECOVERY_GUIDE.md](file:///Users/abhisheksuman/Documents/GitHub/studio/docs/business-audit/AI_FOUNDATION_1_2_MIGRATION_AND_RECOVERY_GUIDE.md) | Corrected provenance definitions, WAL sidecar cleanup in restore, and state classification. |

---

## 5. Automated Verification Evidence

### 5.1 Real `openDb()` Legacy Upgrade Suite (Workstream B)
Executed against an isolated temporary SQLite database populated with schema 006:
1. **Title Collision (Row 1):** Title matches canonical Alapadma, content is user's private routine.  
   *Result:* `isSystemDefault = 0`, `isQuarantined = 1`, `seedKey = null`. Original ID, title, and content intact.
2. **Title & Category Match (Row 2):** Matches Kathak Chakkars title and category, content is user's private routine.  
   *Result:* `isSystemDefault = 0`, `isQuarantined = 1`, `seedKey = null`. Original ID, title, and content intact.
3. **Exact Content Match (Row 3):** Legacy row with identical content to Flamenco Zapateado.  
   *Result:* `isSystemDefault = 0`, `isQuarantined = 1`, `seedKey = null`. Not adopted as default!
4. **Canonical Defaults:** 12 application-owned defaults inserted with `seedKey`s and `isSystemDefault = 1`. Canonical Flamenco Zapateado has its own distinct ID with `seedKey = 'canonical_v1_flamenco_zapateado'`.

### 5.2 Real `openDb()` Post-007 Existing DB Upgrade (Workstream B)
Executed against an isolated temporary SQLite database where 001–007 were applied and users authored private records:
1. **User Ownership Preserved:** User 201 (Alapadma title match), User 202 (Mayura category match), and User 203 (exact content match) all retain `ownerId = 201/202/203`, `isSystemDefault = 0`, `isQuarantined = 0`.
2. **De-Promotion of Unverified Defaults:** Row 40 (which old 007 had marked `isSystemDefault = 1` without an owner) was de-promoted to `isSystemDefault = 0, isQuarantined = 1`.
3. **Multi-Tenant Isolation:** User 201 searches `'lotus blooming'` and sees their private record + system default. User 202 searches `'lotus blooming'` and sees **only** the system default (User 201's private record is completely invisible).
4. **Idempotency:** Re-running `openDb()` causes zero duplicate records.

### 5.3 Real `openDb()` Runner Failure & Rollback (Workstream C)
Executed the **actual production `openDb(testDbFile, tempFixtureDir)`** on a temporary fixture directory:
1. `001_valid.sql`: Creates `fixture_valid_table`.
2. `002_failing.sql`: Creates `fixture_partial_table`, then throws syntax/table error.
3. `003_later.sql`: Creates `fixture_never_reached_table`.
- **Result:** `openDb()` threw error.
- **Rollback:** `fixture_partial_table` was completely rolled back and does not exist. `_migrations` contains `001_valid.sql` only.
- **Halt:** `003_later.sql` was never reached.
- **Recovery:** Fixed `002_failing.sql` in fixture directory and re-invoked `openDb(testDbFile, tempFixtureDir)`. All 3 migrations applied cleanly and all tables exist.

### 5.4 HTTP Story Generation Identity Propagation (Workstream E)
Executed real HTTP requests against `POST /api/content/custom`:
- Unauthenticated request -> HTTP 401.
- User B request with spoofed `{ ownerId: userAId }` -> captured `userId` in `llm.generateStory` is strictly `userBId`. Spoofing rejected.
- User A private keyword (`SuperSecretSpinA99`) is **absent** from User B's generated story.
- User A request retrieves User A's private keyword into story prompt.

---

## 6. Test Results Summary

### 6.1 Targeted Test Suite (`server/test/migration_hardening.test.ts`)
```
✔ Workstream B - Pre-007 Legacy Upgrade through Real openDb() Runner (18.5ms)
✔ Workstream B - Post-007 Existing DB Upgrade with User Ownership & Collision Coexistence (16.8ms)
✔ Workstream B - Clean Empty Database Migration to 008 (1.8ms)
✔ Workstream C - Production openDb() Runner Failure Rollback & Restart Recovery (3.3ms)
▶ Workstream E - HTTP Story Generation Identity Propagation & RAG Isolation
  ✔ Unauthenticated story generation rejected with 401 (23.1ms)
  ✔ User B HTTP story generation passes userBId and isolates private RAG (2.4ms)
  ✔ User A HTTP story generation passes userAId and retrieves User A private RAG (1.9ms)
✔ Workstream E - HTTP Story Generation Identity Propagation & RAG Isolation (61.1ms)
ℹ tests 8 | suites 0 | pass 8 | fail 0
```

### 6.2 Full Regression Suite (`npm test`)
```
✔ auth, brands, ownership isolation (216.5ms)
✔ Async Job State Machine - Unit Level Lifecycle (9.7ms)
✔ Async Jobs API - HTTP Endpoints & Async Render (193.8ms)
✔ Workstream A: Audio-Mode Resolution Order & Safeguards (1.5ms)
✔ Workstream B: Quality Gate Asset Validation by Resolved Audio Mode (1.4ms)
✔ Workstream A & B: API Integration - Invalid Mode Rejection & Isolated Render Validation (167.7ms)
✔ Character Generator Provider - Unit Token Extraction & Scene Injection (0.5ms)
✔ Character Entity Database Persistence & Identity Tokens (1367.0ms)
✔ Character Entity API - Generation and Identity Retrieval Endpoints (1256.6ms)
✔ Experiments API - Authentication, Tenant Isolation & Evidence Security (317.5ms)
✔ LivePortrait Face Animator - Unit Local Motion Synthesis (1190.3ms)
✔ LivePortrait Face Animation API - HTTP Endpoints (1790.3ms)
✔ Workstream C & D: FFmpeg Composition Regression & Output Integrity (2346.3ms)
✔ Workstream B - Pre-007 Legacy Upgrade through Real openDb() Runner (26.6ms)
✔ Workstream B - Post-007 Existing DB Upgrade with User Ownership & Collision Coexistence (20.9ms)
✔ Workstream B - Clean Empty Database Migration to 008 (6.3ms)
✔ Workstream C - Production openDb() Runner Failure Rollback & Restart Recovery (6.2ms)
✔ Workstream E - HTTP Story Generation Identity Propagation & RAG Isolation (301.2ms)
✔ Originality Engine - similarity and repetition detection (0.6ms)
✔ Subtitle SRT Generator (0.1ms)
✔ Phase 2 Content Engine - Ideas, 5-Scene Stories, and Full Workflow (41040.8ms)
✔ Platform Adaptation Engine - YouTube, Instagram, TikTok derivatives (0.5ms)
✔ Quality Gate Engine - Safety policy & Copyright risk verification (1.1ms)
✔ Phase 3 - Quality Gate, Approval, Scene Regeneration & Publishing Calendar API (40744.2ms)
✔ RAG Engine - Seeding, Token Search & Knowledge Enrichment (10.1ms)
✔ Local LLM Provider with RAG - Authentic Mudras & Viral Hooks in 5-Scene Story (6.0ms)
✔ RAG Security & Multi-Tenant Isolation Suite (208.7ms)
ℹ tests 55 | suites 0 | pass 55 | fail 0 | cancelled 0 | skipped 0 | todo 0
ℹ duration_ms 41515.5ms
```

### 6.3 Compilation & Database Integrity
- `npm run typecheck` (`tsc --noEmit`): **0 errors**.
- `npm run build` (`vite build web`): **373ms, 0 errors**.
- `PRAGMA integrity_check;` on `data/studio.db`: `ok`.
- `PRAGMA foreign_key_check;` on `data/studio.db`: `0 errors`.

---

## 7. Zero-Cost & Dependency Compliance

- **Monetary Cost Incurred:** **\$0.00**.
- **External Network Services:** None.
- **Dependencies Installed:** 0.
- **Model Checkpoints Downloaded:** 0.
- **Licence Compatibility:** 100% compliant with existing MIT / Apache-2.0 codebase.

---

## 8. Remaining Limitations

1. **Unowned Legacy Data Recovery:**  
   If an administrator had legacy records from pre-007 where ownership was not recorded in the database, automated migrations cannot infer who authored them and will leave them in quarantine. An administrator must inspect `metadata` manually to reassign ownership.
2. **Dense Semantic Embeddings:**  
   RAG token search remains substring keyword matching until vector search (`sqlite-vec` + `bge-small-en-v1.5`) is introduced in AI-Foundation 4.

---

## 9. Final Phase Exit Gate Verdict

All completion criteria for AI-Foundation 1.2.2 are fully met:
- Title-based legacy promotion in Migration 007 is completely removed.
- Canonical defaults are inserted with immutable `seedKey`s rather than reclassifying historical rows.
- Private title collisions retain ownership and coexist with canonical defaults.
- Real `openDb()` runner execution and failure atomicity are proven on actual SQLite databases.
- The recovery guide reflects accurate provenance, quarantine, and WAL restore principles.

**Final Verdict:** **`AI_FOUNDATION_1_2_2_COMPLETE`**

---

## 10. Stop Condition

Execution has halted. AI-Foundation 2 has not been started. No models have been downloaded. Awaiting your review and explicit authorization before proceeding.

