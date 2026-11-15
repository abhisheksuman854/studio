# Auravo Studio — AI-Foundation 1.2.1: Migration Provenance Sequence & Recovery Verification Report

**Document ID:** `AURAVO-AIF1.2.1-VERIFICATION-20261116`  
**Date:** November 16, 2026  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Branch:** `main`  
**Baseline Commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`  
**Target Verified:** AI-Foundation 1.2 (`AURAVO-AIF1.2-REMEDIATION-20261116`)  
**Audit Verdict:** **`AI_FOUNDATION_1_2_SECURITY_BLOCKED`**

---

## 1. Executive Summary & Verdict

This independent forensic audit evaluates the migration sequence, provenance classification, migration runner atomicity, test integrity, and recovery procedures introduced in **AI-Foundation 1.2**.

The audit was conducted under **STRICT READ-ONLY** constraints. No source files, migrations, tests, documentation, databases, or Git references were modified.

The audit verdict is **`AI_FOUNDATION_1_2_SECURITY_BLOCKED`**.

### Primary Reason for Security Block
Forensic examination of the ordered migration sequence reveals that **Migration 007 continues to promote private legacy records to globally visible system defaults before Migration 008 executes**.

Specifically:
1. In [server/migrations/007_rag_tenant_isolation.sql:5-7](file:///Users/abhisheksuman/Documents/GitHub/studio/server/migrations/007_rag_tenant_isolation.sql#L5-L7), `ALTER TABLE rag_knowledge ADD COLUMN ownerId` adds the column with no default, setting `ownerId = NULL` for **every** pre-existing row in the table.
2. In lines 10–25 of the same migration, `UPDATE rag_knowledge SET isSystemDefault = 1, ownerId = NULL ... WHERE title IN (...) AND (ownerId IS NULL);` executes. Because `ownerId` was just created as `NULL`, the newly added condition `AND (ownerId IS NULL)` evaluates to **TRUE for all legacy records**.
3. Any user-created record in a pre-007 database whose title matches one of the 12 canonical titles is immediately promoted to `isSystemDefault = 1` and its ownership is erased.
4. When Migration 008 subsequently runs, it cannot recover the user's ownership because `ownerId` was already overwritten with `NULL` by Migration 007. If the content differs from the canonical default, Migration 008 sends the record to quarantine (`isQuarantined = 1`), permanently alienating the user from their data. If the content happens to match, Migration 008 permanently cements it as a global canonical default (`seedKey = ...`).
5. In [server/test/migration_hardening.test.ts:60-61](file:///Users/abhisheksuman/Documents/GitHub/studio/server/test/migration_hardening.test.ts#L60-L61), this vulnerability was masked because the test fixture manually executed `UPDATE rag_knowledge SET ownerId = 101, isSystemDefault = 0` **between** Migration 007 and Migration 008—an artificial intervention that never occurs in a real database upgrade.

Under the explicit mandate of this audit (*"A fresh-install migration path that can promote a private legacy record to a global default must receive AI_FOUNDATION_1_2_SECURITY_BLOCKED"*), this phase is blocked until the migration sequence is reconciled.

---

## 2. Critical Investigation A — Migration 007 → 008 Sequence Analysis

### 2.1 Reconstructed SQL Execution Trace (Legacy DB Upgrading 006 → 007 → 008)

Suppose an installation has a pre-existing database running schema `006_rag_knowledge.sql` where a user created private choreography record ID 1:
```sql
INSERT INTO rag_knowledge(id, category, title, content)
VALUES (1, 'CHOREOGRAPHY', 'Alapadma Mudra (Blooming Lotus)', 'User private custom choreo details');
```
At this point, `rag_knowledge` has columns `(id, category, title, content, tags, metadata, createdAt)`. There is **no `ownerId` column**.

#### Step 1: Application Runs Migration 007 (`server/migrations/007_rag_tenant_isolation.sql`)
- **Line 5:** `ALTER TABLE rag_knowledge ADD COLUMN ownerId INTEGER REFERENCES users(id);`  
  *Result:* SQLite adds `ownerId` column. Row 1 now has `ownerId = NULL`.
- **Line 6:** `ALTER TABLE rag_knowledge ADD COLUMN isSystemDefault INTEGER NOT NULL DEFAULT 0;`  
  *Result:* Row 1 has `isSystemDefault = 0`.
- **Line 7:** `ALTER TABLE rag_knowledge ADD COLUMN isQuarantined INTEGER NOT NULL DEFAULT 0;`  
  *Result:* Row 1 has `isQuarantined = 0`.
- **Lines 10–25:**
  ```sql
  UPDATE rag_knowledge
  SET isSystemDefault = 1, ownerId = NULL, isQuarantined = 0
  WHERE title IN (
    'Alapadma Mudra (Blooming Lotus)',
    ...
  ) AND (ownerId IS NULL);
  ```
  *Evaluation of condition on Row 1:*
  - `title IN ('Alapadma Mudra (Blooming Lotus)', ...)` -> **TRUE**.
  - `(ownerId IS NULL)` -> **TRUE** (because line 5 set all existing rows to `NULL`).
  *Execution Result:* **Row 1 is updated to `isSystemDefault = 1, ownerId = NULL, isQuarantined = 0`**.
  *Security Event:* **User private record is now globally visible to all tenants as a system default**.
- **Line 37:** Migration 007 commits. `_migrations` records `'007_rag_tenant_isolation.sql'`.

#### Step 2: Application Runs Migration 008 (`server/migrations/008_rag_provenance_hardening.sql`)
- **Line 6:** `ALTER TABLE rag_knowledge ADD COLUMN seedKey TEXT;`
- **Lines 9–14:**
  ```sql
  UPDATE rag_knowledge
  SET seedKey = 'canonical_v1_alapadma_mudra', isSystemDefault = 1, ownerId = NULL, isQuarantined = 0
  WHERE category = 'CHOREOGRAPHY'
    AND title = 'Alapadma Mudra (Blooming Lotus)'
    AND content = 'Full blooming lotus hand gesture...'
    AND (ownerId IS NULL);
  ```
  *Evaluation on Row 1:* Content does not match canonical text (`'User private custom choreo details'`). Row 1 is **not** updated; `seedKey` remains `NULL`.
- **Lines 95–97:**
  ```sql
  UPDATE rag_knowledge
  SET isSystemDefault = 0
  WHERE isSystemDefault = 1 AND seedKey IS NULL AND ownerId IS NOT NULL;
  ```
  *Evaluation on Row 1:* `ownerId IS NOT NULL` is **FALSE** (Migration 007 set it to `NULL`). Row 1 is skipped.
- **Lines 100–102:**
  ```sql
  UPDATE rag_knowledge
  SET isSystemDefault = 0, isQuarantined = 1
  WHERE isSystemDefault = 1 AND seedKey IS NULL AND ownerId IS NULL;
  ```
  *Evaluation on Row 1:*
  - `isSystemDefault = 1` -> **TRUE** (set by Migration 007).
  - `seedKey IS NULL` -> **TRUE**.
  - `ownerId IS NULL` -> **TRUE**.
  *Execution Result:* Row 1 is updated to `isSystemDefault = 0, isQuarantined = 1`.
  *Outcome:* Row 1 is quarantined, but `ownerId` remains `NULL`. The user has permanently lost their private record.

---

### 2.2 Answers to Investigation A Questions

| # | Question | Finding & Source Line Evidence |
|:---:|---|---|
| 1 | Does Migration 007 add `ownerId` before executing classification? | **YES.** `server/migrations/007_rag_tenant_isolation.sql:5` adds `ownerId` before line 10 executes the UPDATE. |
| 2 | What is the default value of `ownerId` for pre-existing records? | **`NULL`.** SQLite sets all pre-existing rows to `NULL` for newly added columns without a constant default. |
| 3 | Does Migration 007 classify rows using title matching? | **YES.** Line 12 uses `WHERE title IN ('Alapadma Mudra (Blooming Lotus)', ...)`. |
| 4 | Does adding `AND ownerId IS NULL` actually exclude legacy private records? | **NO.** Because line 5 initialized `ownerId` as `NULL` for all legacy records, `AND (ownerId IS NULL)` is a tautology that matches 100% of pre-existing rows. |
| 5 | Can Migration 007 set a private record's `isSystemDefault` to 1 before 008 runs? | **YES.** Any pre-existing record with a matching title is promoted to `isSystemDefault = 1` when 007 commits. |
| 6 | Does Migration 008 have sufficient information to recover original ownership? | **NO.** Migration 008 only sees `ownerId IS NULL`. It cannot determine which user authored the record and is forced to quarantine it. |
| 7 | Can an exact category/title/content collision be mistaken for a canonical record? | **YES.** If a user-created legacy record had matching category, title, and content, Migration 008 lines 9–91 assigns it `seedKey = 'canonical_v1_...'` and sets `isSystemDefault = 1`. |
| 8 | Does the result differ between a fresh database and an existing installation? | **YES.** On databases where 007 was already applied before modification, 007 is skipped by `_migrations`. On fresh installs, 007 runs with `AND (ownerId IS NULL)`. But on an empty DB, both 007 and 008 affect 0 rows, concealing the defect. |

---

## 3. Critical Investigation B — Provenance Strength Assessment

1. **Content Matching vs. Verified Provenance:**  
   Migration 008 relies on `WHERE category = ? AND title = ? AND content = ? AND (ownerId IS NULL)`. This is **strong string matching**, not immutable cryptographic provenance. Prior to Migration 008, no `seedKey`, digital signature, or seed version identifier existed in the schema.
2. **Ambiguous Legacy Records:**  
   Ambiguous legacy records are quarantined (`isQuarantined = 1`), which prevents cross-tenant data leakage. However, because Migration 007 sets `ownerId = NULL`, known user ownership cannot be preserved for any legacy record whose title matched a canonical seed.
3. **Runtime Seeder Behavior (`server/providers/rag_engine.ts:144-169`):**  
   `seedDefaultsIfNeeded()` checks `SELECT id FROM rag_knowledge WHERE seedKey = ?`. If missing, it inserts the canonical record with a `seedKey`. It does **not** overwrite user-created records because user records have `seedKey = NULL`. This runtime behavior is safe, but it does not cure the DDL defect in Migration 007.

---

## 4. Investigation C — Migration 007 Historical Integrity

Modifying an already-applied migration file in-place (`007_rag_tenant_isolation.sql`) violated migration immutability principles:
1. **Split-Brain Schema Definition:**  
   The authoritative database `data/studio.db` already recorded `007_rag_tenant_isolation.sql` before line 25 was edited. Consequently, `data/studio.db` never executed `AND (ownerId IS NULL)`. Any new database executes the modified file.
2. **Proper Forward-Fix Architecture:**  
   Migration 007 should have remained strictly immutable. All provenance corrections, column additions (`seedKey`), and default reconciliations should have been performed exclusively in `008_rag_provenance_hardening.sql`.
3. **Fresh Install Danger:**  
   Because Migration 007 was retained in the fresh install sequence with its flawed `WHERE title IN (...)` logic, any migration runner executing 001 through 008 sequentially remains vulnerable to the intermediate promotion defect.

---

## 5. Investigation D — Migration Runner Atomicity

### 5.1 Production Runner Verification (`server/db.ts`)
Inspection of [server/db.ts:13-17](file:///Users/abhisheksuman/Documents/GitHub/studio/server/db.ts#L13-L17):
```typescript
db.transaction(() => {
  db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
})();
```
- **Atomicity:** Verified. The migration script execution and `_migrations` tracking insertion execute within a single SQLite transaction.
- **Error Handling:** Verified. Any exception throws immediately, rolls back all DDL statements in `f`, and halts server startup.
- **Removal of Duplicate-Column Catch:** Verified. The blanket catch block was completely removed.

### 5.2 Defect in Migration Runner Failure Test
Inspection of [server/test/migration_hardening.test.ts:186-228](file:///Users/abhisheksuman/Documents/GitHub/studio/server/test/migration_hardening.test.ts#L186-L228):
```typescript
test('Workstream B - Migration Runner Multi-Statement Atomicity & Rollback on Failure', (t) => {
  const db = new Database(':memory:');
  ...
  db.transaction(() => {
    db.exec(scriptContent);
    db.prepare('INSERT INTO _migrations VALUES(?)').run('999_failing_migration.sql');
  })();
```
- **Observation:** The test does **not** call `openDb()`. It constructs an inline `new Database(':memory:')` and recreates the transaction block manually.
- **Finding:** The test verifies SQLite's transaction rollback semantics, but it does **not** test the actual production migration discovery loop in `openDb()`.

---

## 6. Investigation E — HTTP Story-Generation Integration

Inspection of [server/test/migration_hardening.test.ts:241-372](file:///Users/abhisheksuman/Documents/GitHub/studio/server/test/migration_hardening.test.ts#L241-L372):
1. **Express & Middleware:** Uses real Express app bound to dynamic port `0` (`createApp(db, { providers: { llm: spyLLM, ragEngine } })`).
2. **Session Authentication:** Authenticates via real SHA-256 session cookie (`sid=...`).
3. **Route Verified:** Calls `POST /api/content/custom`.
4. **Identity Propagation:** Verified that `uid(req)` populates `userId` from verified session and passes it to `llm.generateStory`.
5. **Spoofing Guard:** Request body `{ ownerId: userAId }` had zero effect; `lastCapturedUserId` was strictly `userBId`.
6. **RAG Boundary:** User A's private keyword (`SuperSecretSpinA99`) did not leak into User B's generated story.
7. **Providers Parameter:** In production, `opts.providers` is omitted, causing `createApp` to default to standard `LocalLLMProvider` and `RAGEngine`. No unintended production side-effects.

---

## 7. Investigation F — Recovery Guide Accuracy

Inspection of `docs/business-audit/AI_FOUNDATION_1_2_MIGRATION_AND_RECOVERY_GUIDE.md`:
1. **Quarantine Query Hazard (Section 3.3, Lines 100–102):**
   ```sql
   UPDATE rag_knowledge
   SET isQuarantined = 1, isSystemDefault = 0
   WHERE isSystemDefault = 0 AND ownerId IS NULL;
   ```
   If executed on a database before `seedDefaultsIfNeeded()` or before Migration 008 sets `seedKey`, this query quarantines intended system defaults.
2. **WAL Sidecar Omission in Restore (Section 4, Step 3, Line 131):**
   The guide provides `cp "${BACKUP_FILE}" ./data/studio.db`. If WAL mode is active, failing to remove `./data/studio.db-wal` and `./data/studio.db-shm` prior to restoring leads to log replay corruption.
3. **Immutability Framing:**
   Section 5 frames content-matched records as "immutable provenance," obscuring the fact that pre-008 records were classified post-hoc via title and content strings.

---

## 8. Test Fixture Artifice Analysis

In [server/test/migration_hardening.test.ts:57-63](file:///Users/abhisheksuman/Documents/GitHub/studio/server/test/migration_hardening.test.ts#L57-L63):
```typescript
// Run migration 007
db.exec(fs.readFileSync(path.join(dir, '007_rag_tenant_isolation.sql'), 'utf8'));
db.prepare('INSERT INTO _migrations VALUES(?)').run('007_rag_tenant_isolation.sql');

// Associate known ownerIds for user records 1 and 2
db.prepare('UPDATE rag_knowledge SET ownerId = 101, isSystemDefault = 0 WHERE id = 1').run();
db.prepare('UPDATE rag_knowledge SET ownerId = 102, isSystemDefault = 0 WHERE id = 2').run();

// Now apply migration 008 (Provenance Hardening)
db.exec(fs.readFileSync(path.join(dir, '008_rag_provenance_hardening.sql'), 'utf8'));
```

**Forensic Finding:**  
The test passes **only because lines 60–61 artificially patch `ownerId = 101` and `isSystemDefault = 0` between Migration 007 and Migration 008**.  
If lines 60–61 are removed:
- Migration 007 sets Row 1 to `isSystemDefault = 1, ownerId = NULL`.
- Migration 008 sets Row 1 to `isSystemDefault = 0, isQuarantined = 1`.
- Assertion line 89 (`assert.equal(user1Item.ownerId, 101)`) **fails**, because `ownerId` is `NULL`.

The test fixture does **not** prove that Migration 007 preserves legacy private records; it proves that **manual test intervention** preserved them.

---

## 9. Git & Working-Tree State

- **Branch:** `main`
- **HEAD Commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`
- **Integrity Statement:** Strictly read-only audit. Zero source, migration, or test files were modified.

---

## 10. Final Audit Verdict & Mandatory Prerequisites

### Verdict: **`AI_FOUNDATION_1_2_SECURITY_BLOCKED`**

### Mandatory Conditions Before AI-Foundation 2 May Begin
1. **Neutralize Migration 007 Title Promotion:**  
   Remove the title-based promotion from `server/migrations/007_rag_tenant_isolation.sql` entirely (or ensure it leaves all existing records unpromoted with `isSystemDefault = 0`), so that a fresh migration sequence cannot promote a legacy record to a system default.
2. **Reconcile Canonical Defaults Exclusively in 008:**  
   Ensure canonical default classification is performed exclusively by composite key/content verification in Migration 008.
3. **Remove Test Interventions:**  
   Update `server/test/migration_hardening.test.ts` so the legacy fixture runs directly through `openDb()` without manual SQL patches between migration steps.
4. **Test Real `openDb()` Failure:**  
   Update the migration runner failure test to execute `openDb()` against an actual failing migration file in a fixture directory.
5. **Update Recovery Guide:**  
   Correct the WAL sidecar removal commands in the restore procedure.

**STOP. Awaiting user review and authorization before any remediation or progression to AI-Foundation 2.**

