# Auravo Studio — AI-Foundation 1.2.2.1: Previously Applied Migration Compatibility & Seed Provenance Audit Report

**Document ID:** `AURAVO-AIF1.2.2.1-COMPATIBILITY-AUDIT-20261116`  
**Date:** November 16, 2026  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Branch:** `main`  
**Baseline Commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`  
**Target Phase Verified:** AI-Foundation 1.2.2 (`AURAVO-AIF1.2.2-REMEDIATION-20261116`)  
**Audit Verdict:** **`AI_FOUNDATION_1_2_2_SECURITY_BLOCKED`**

---

## 1. Executive Summary & Verdict

This forensic audit independently evaluates the migration compatibility, convergence behavior, seed-key immutability, and recovery safety of **AI-Foundation 1.2.2**, with a specific focus on databases that have **already applied the original versions of Migration 007 and Migration 008**.

The audit was conducted under **STRICT READ-ONLY** constraints. No source files, SQL migrations, test files, documentation, databases, or Git references were modified.

The audit verdict is **`AI_FOUNDATION_1_2_2_SECURITY_BLOCKED`**.

### Primary Reason for Security Block
In AI-Foundation 1.2.2, the remediation of the title-matching and content-matching defects was implemented by **editing the historical migration files `007_rag_tenant_isolation.sql` and `008_rag_provenance_hardening.sql` in-place**.

Forensic inspection of the migration runner in [server/db.ts:12](file:///Users/abhisheksuman/Documents/GitHub/studio/server/db.ts#L12) demonstrates:
```typescript
if (db.prepare('SELECT 1 FROM _migrations WHERE name=?').get(f)) continue;
```
Because the migration runner discovers and executes scripts strictly based on whether their filename is recorded in `_migrations`:
1. Any database that already applied the original Migration 007 and original Migration 008 (such as existing staging/production environments or the local repository database `data/studio.db`) **skips both modified 007 and modified 008 completely**.
2. **The new de-promotion and quarantine logic in modified 008 NEVER executes on those databases.**
3. If an existing database contained a legacy private record that was assigned a `seedKey` and promoted to `isSystemDefault = 1` by the original Migration 008 (via content matching), **that record remains globally exposed as an immutable system default across all tenants**.
4. In-place modification of historical migrations creates a split-brain architecture where fresh installations execute the corrected logic, but previously upgraded installations remain vulnerable and **fail to converge to the secure state**.
5. To safely reconcile existing databases without destructive rollbacks, relational database engineering requires a **new, sequential forward migration** (e.g. `009_rag_provenance_reconciliation.sql`).

---

## 2. Critical Investigation: Already-Applied Migrations

### 2.1 The In-Place Editing Defect Trace
Suppose an installation upgraded to AI-Foundation 1.2 prior to AI-Foundation 1.2.2:
- Migration `007_rag_tenant_isolation.sql` executed (original version: title matching).
- Migration `008_rag_provenance_hardening.sql` executed (original version: content matching).
- In SQLite `_migrations` table, the following rows were recorded:
  - `'007_rag_tenant_isolation.sql'`
  - `'008_rag_provenance_hardening.sql'`
- Suppose that database contained a legacy private record (e.g. ID 42) whose content matched one of the canonical definitions (e.g. Flamenco Zapateado). Original Migration 008 lines 31–36 assigned ID 42 `seedKey = 'canonical_v1_flamenco_zapateado'` and `isSystemDefault = 1, ownerId = NULL`.

Now, the host updates its codebase to AI-Foundation 1.2.2 and restarts the application:

```typescript
// server/db.ts:10-12
const dir = migrationsDir ?? path.join(import.meta.dirname, 'migrations');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  if (db.prepare('SELECT 1 FROM _migrations WHERE name=?').get(f)) continue;
  ...
}
```

### 2.2 Forensic Answers to Investigation Questions

| Investigation Question | Forensic Determination | Source Evidence & Mechanism |
|---|:---:|---|
| **Will `openDb()` execute the modified 007?** | **NO** | `SELECT 1 FROM _migrations WHERE name='007_rag_tenant_isolation.sql'` returns a row. The runner executes `continue` at [server/db.ts:12](file:///Users/abhisheksuman/Documents/GitHub/studio/server/db.ts#L12) and skips the file. |
| **Will `openDb()` execute the modified 008?** | **NO** | `SELECT 1 FROM _migrations WHERE name='008_rag_provenance_hardening.sql'` returns a row. The runner executes `continue` at [server/db.ts:12](file:///Users/abhisheksuman/Documents/GitHub/studio/server/db.ts#L12) and skips the file. |
| **Can the database receive the new de-promotion and quarantine logic?** | **NO** | The SQL statements in modified 008 (`UPDATE rag_knowledge SET isSystemDefault = 0, isQuarantined = 1...`) are contained inside the skipped file and never reach the SQLite engine. |
| **Can an old incorrectly assigned `seedKey` survive?** | **YES** | Because modified 008 is skipped, Row 42 retains `seedKey = 'canonical_v1_flamenco_zapateado'`. |
| **Can an incorrectly promoted record remain globally visible?** | **YES** | Row 42 retains `isSystemDefault = 1` and `ownerId = NULL`. When foreign tenants query `/api/rag/search`, the SQL filter `WHERE (ownerId = ? OR isSystemDefault = 1)` continues to return the user's private record. |
| **Does the current recovery guide correctly handle this state?** | **NO** | Section 4.1 of `AI_FOUNDATION_1_2_MIGRATION_AND_RECOVERY_GUIDE.md` incorrectly assumes that any installation with 007 and 008 applied is clean ("State C: Canonical defaults carry seedKey. Unverified rows remain quarantined"). It ignores the content-matched seedKey vulnerability on databases that applied original 008. |

---

## 3. Required Migration-State Matrix

The behavior of `openDb()` and schema state was modeled across all 6 possible operational states:

| State | Database History Prior to Upgrade | Migrations Executed on 1.2.2 Startup | Migrations Skipped | Ownership Loss Risk | False System-Default Risk | Incorrect `seedKey` Risk | Converges to Secure State? |
|:---:|---|---|---|:---:|:---:|:---:|:---:|
| **A** | **Fresh Database** (empty, no migrations) | `001` through `008` (modified) | None | None | None | None | **YES** |
| **B** | **Existing Database** (original 007 applied, 008 not applied) | `008` (modified) | `001`–`007` | **High** (original 007 wiped `ownerId` to `NULL`) | None (modified 008 de-promotes unverified defaults) | None (modified 008 inserts seeds directly) | **PARTIAL** (Secured from public view, but erased ownership unrecoverable) |
| **C** | **Existing Database** (original 007 AND original 008 applied) | **NONE** | `001`–`008` | **High** (wiped by original 007) | **HIGH** (content-matched defaults remain `isSystemDefault = 1`) | **HIGH** (content-matched `seedKey`s persist) | **NO (BLOCKED)** |
| **D** | **Existing Database** (corrected 007 applied, 008 not applied) | `008` (modified) | `001`–`007` | None | None | None | **YES** |
| **E** | **Existing Database** (corrected 007 AND corrected 008 applied) | **NONE** | `001`–`008` | None | None | None | **YES** |
| **F** | **Existing Database** (old 008 assigned `seedKey` via content match) | **NONE** | `001`–`008` | **Permanent** | **PERMANENT** (remains globally visible default) | **PERMANENT** (canonical key assigned to private row) | **NO (BLOCKED)** |

### Convergence Failure Diagnosis
For **Case C** and **Case F**, the database **cannot converge safely without a forward migration**.  
Because `openDb()` only executes migrations whose filename is absent from `_migrations`, modifying existing files 007 and 008 creates an unpatchable dead-end for any database that ran the earlier versions. Only a new forward migration file (`009_...sql`) will be recognized by `openDb()` on those databases.

---

## 4. Seed-Key Provenance and Immutability Findings

### 4.1 Database Layer Constraints (`server/migrations/008_rag_provenance_hardening.sql`)
The schema defines:
```sql
ALTER TABLE rag_knowledge ADD COLUMN seedKey TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_seed_key ON rag_knowledge(seedKey) WHERE seedKey IS NOT NULL;
```
- **Uniqueness vs. Immutability:**  
  A SQLite unique partial index **enforces uniqueness only**. It does **not** enforce immutability.
- **Absence of Database Triggers:**  
  There are zero SQLite `BEFORE UPDATE` or `BEFORE DELETE` triggers on `rag_knowledge`. If an administrator, direct script, background job, or raw SQL query executes:
  ```sql
  UPDATE rag_knowledge SET content = 'Tampered Content' WHERE seedKey = 'canonical_v1_alapadma_mudra';
  UPDATE rag_knowledge SET seedKey = 'canonical_v1_hacked' WHERE id = 1;
  ```
  SQLite will permit the mutation without constraint violations.
- **Application Layer Dependency:**  
  Immutability of system defaults is enforced solely by TypeScript logic in [server/providers/rag_engine.ts:342-344](file:///Users/abhisheksuman/Documents/GitHub/studio/server/providers/rag_engine.ts#L342-L344):
  ```typescript
  if (existing.isSystemDefault) {
    return { ok: false, status: 403, error: 'System default knowledge items are immutable' };
  }
  ```
  While the TypeScript API routes reject mutation of `isSystemDefault = 1` rows, the database schema itself lacks native immutability enforcement.

### 4.2 API Spoofing Protection
Inspection of [server/content_engine.ts:248-251](file:///Users/abhisheksuman/Documents/GitHub/studio/server/content_engine.ts#L248-L251) and [276-279](file:///Users/abhisheksuman/Documents/GitHub/studio/server/content_engine.ts#L276-L279):
```typescript
if ('ownerId' in req.body || 'isSystemDefault' in req.body || 'isQuarantined' in req.body || 'seedKey' in req.body) {
  return res.status(400).json({ error: 'Specifying ownerId, isSystemDefault, isQuarantined, or seedKey is forbidden' });
}
```
- **Finding:** Verified. Ordinary authenticated API requests attempting to inject or update `seedKey` via `POST /api/rag/knowledge` or `PUT /api/rag/knowledge/:id` are rejected with HTTP 400 Bad Request.

### 4.3 Distinguishability of Content-Matched vs. Trusted Seed Keys
In a database where original Migration 008 ran:
- A legacy row that received `seedKey = 'canonical_v1_alapadma_mudra'` via content matching has:
  `seedKey = 'canonical_v1_alapadma_mudra', isSystemDefault = 1, ownerId = NULL, isQuarantined = 0`.
- A row inserted cleanly by corrected Migration 008 has:
  `seedKey = 'canonical_v1_alapadma_mudra', isSystemDefault = 1, ownerId = NULL, isQuarantined = 0`.
- **Finding:** **There is zero internal column, flag, or checksum distinguishing a content-matched row from an application-seeded row.** The only difference may be the auto-increment `id` or row creation timestamp.

---

## 5. Recovery Guide Verification

Inspection of `docs/business-audit/AI_FOUNDATION_1_2_MIGRATION_AND_RECOVERY_GUIDE.md`:

| Section | Topic | Assessment | Finding / Required Correction |
|---|---|:---:|---|
| **Section 3.3** | Fail-Closed Quarantine Query | **CAUTION** | Query `UPDATE rag_knowledge SET isQuarantined = 1, isSystemDefault = 0 WHERE seedKey IS NULL AND (ownerId IS NULL);` is safe only if Migration 008 has run. If run on pre-008 databases, it crashes (`no such column: seedKey`). |
| **Section 4.1** | Database State Classification | **DEFICIENT** | Omits State C/F (databases where both original 007 and original 008 were recorded). Falsely claims that any database with 007 and 008 recorded is in a safe state. |
| **Section 4.1 (State D)** | Erased Legacy Ownership | **ACCURATE** | Truthfully states that automated migrations cannot guess erased owners, and that manual administrator inspection of metadata is required. |
| **Section 2.1** | Native SQLite Backup | **ACCURATE** | Uses atomic `sqlite3 .backup`, consistent with rollback and WAL modes. |
| **Section 4.2 (Step 3)** | WAL Restore Procedure | **ACCURATE** | Properly instructs stopping processes and removing stale `-wal` and `-shm` sidecars before copying the database file. |
| **Section 4** | Inspection vs. Destructive Repair | **DEFICIENT** | Lacks read-only diagnostic SQL queries for operators to inspect their migration state before running destructive `UPDATE` statements. |

---

## 6. Test Integrity & Coverage Gaps

Inspection of [server/test/migration_hardening.test.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/test/migration_hardening.test.ts):
1. **Real `openDb()` Execution:**  
   Verified. The test suite invokes the real production `openDb()` runner for pre-007 upgrades, post-007 upgrades, and failure rollbacks.
2. **Missing Test Coverage for Case C & Case F:**  
   The test suite in `migration_hardening.test.ts:79` tests an existing database where **007 was applied and 008 was NOT applied**.  
   **There is zero automated test in the repository testing an existing database where BOTH original 007 AND original 008 are already recorded in `_migrations`**.
3. **Missing Forward Migration Test:**  
   Because no forward migration (`009_...sql`) exists, there is no test verifying that an already-migrated database can be safely healed upon application upgrade.

---

## 7. Git Working-Tree Audit

- **Current Branch:** `main`
- **HEAD Commit:** `b34e9ee6b10939de214dac8a3fb59ce13556d08b`
- **Audit Mode:** Strict read-only. No application code, test code, database records, or migrations were altered.

---

## 8. Recommended Minimal Forward-Fix Strategy

To resolve the security block and ensure all databases converge to the secure state regardless of their upgrade history:

### 1. Author Forward Migration `server/migrations/009_rag_provenance_reconciliation.sql`
Because `009_...sql` is a new filename, `openDb()` will discover and execute it across **all** existing databases, including those where original 007 and 008 are already recorded in `_migrations`:
```sql
-- Auravo Studio - Migration 009: RAG Provenance Reconciliation for Previously Migrated Databases
-- Reconciles databases where legacy 007 or 008 previously ran and may have assigned seedKeys via content matching.

-- 1. Ensure seedKey column and unique index exist
-- (SQLite duplicate column handling or table inspection)

-- 2. De-promote any system default that was not inserted by trusted canonical definition
-- If any row has isSystemDefault = 1 but lacks a verified seedKey, quarantine it:
UPDATE rag_knowledge
SET isSystemDefault = 0, isQuarantined = 1
WHERE isSystemDefault = 1 AND seedKey IS NULL;

-- 3. Quarantine all legacy unowned rows that lack a canonical seedKey:
UPDATE rag_knowledge
SET isQuarantined = 1, isSystemDefault = 0
WHERE seedKey IS NULL AND ownerId IS NULL;

-- 4. Ensure all 12 canonical defaults exist with immutable seedKeys
INSERT OR IGNORE INTO rag_knowledge (seedKey, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
VALUES
  ('canonical_v1_alapadma_mudra', ...),
  ...
;
```

### 2. Add Test Fixture for Case C / Case F
In `server/test/migration_hardening.test.ts`, add a test fixture initializing a database with `007` and old `008` recorded in `_migrations`, containing a content-matched legacy row. Run `openDb()`, and prove that `009` successfully reconciles the database.

### 3. Update Migration Guide
Update `docs/business-audit/AI_FOUNDATION_1_2_MIGRATION_AND_RECOVERY_GUIDE.md` to document State C/F and provide diagnostic read-only queries.

---

## 9. Final Phase Exit Gate Verdict

Because editing migration files in-place fails to update databases where Migration 008 was already applied, leaving legacy private records exposed as system defaults in existing environments:

**Final Verdict:** **`AI_FOUNDATION_1_2_SECURITY_BLOCKED`**

### Mandatory Conditions Before AI-Foundation 2
1. Author forward migration `009_rag_provenance_reconciliation.sql` to reconcile already-migrated databases.
2. Add automated regression tests proving that databases with both 007 and 008 recorded converge safely through `openDb()`.
3. Update `AI_FOUNDATION_1_2_MIGRATION_AND_RECOVERY_GUIDE.md` with diagnostic inspection queries and State C/F reconciliation instructions.

**STOP. Awaiting explicit user review and authorization before any forward migration is authored.**

