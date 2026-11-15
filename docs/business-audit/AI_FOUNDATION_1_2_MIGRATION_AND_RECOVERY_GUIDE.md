# Auravo Studio — SQLite Migration, Provenance & Operational Recovery Guide

**Document ID:** `AURAVO-AIF1.2-GUIDE-20261116`  
**Phase:** AI-Foundation 1.2.2.3  
**Date:** November 16, 2026  
**Scope:** Authoritative SQLite lifecycle, migration atomicity, canonical provenance reconciliation, database-level trigger protection (UPDATE, DELETE, INSERT), backup, and forward-fix procedures.

---

## 1. Authoritative SQLite Architecture & Migration Lifecycle

### 1.1 Database Path Discovery
The authoritative production and local runtime database path is configured in [server/index.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/index.ts#L3):
```typescript
const db = openDb(process.env.DATABASE_PATH ?? './data/studio.db');
```
- **Authoritative local path:** `/Users/abhisheksuman/Documents/GitHub/studio/data/studio.db`
- **Sidecar & directory structure:** `data/` contains `studio.db` alongside media and job artifacts in `data/storage/` and `data/scratch/`.
- **Journal Mode:** Standard rollback journal (`PRAGMA journal_mode;` returns `delete`). If WAL mode is ever activated (`PRAGMA journal_mode = WAL;`), SQLite generates `-wal` and `-shm` sidecar files that must be handled with care during backups and restores.

### 1.2 Migration Discovery & Ordering
Migrations are stored in [server/migrations/](file:///Users/abhisheksuman/Documents/GitHub/studio/server/migrations/) and discovered dynamically by [server/db.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/db.ts):
1. **Naming convention:** Zero-padded sequential numbering: `001_init.sql`, `002_...sql`, ..., `008_rag_provenance_hardening.sql`, `009_rag_provenance_reconciliation.sql`, `010_rag_default_insert_protection.sql`.
2. **Discovery filter:** Scans `server/migrations/*.sql` and sorts them in ascending lexicographical order via `sort()`.
3. **Tracking table:** Tracks applied migrations in `_migrations(name TEXT PRIMARY KEY)`.
4. **Idempotency check:** `SELECT 1 FROM _migrations WHERE name=?`. If present, the runner executes `continue` and skips the file entirely.

### 1.3 Why In-Place Historical Migration Edits Fail on Upgraded Databases
Because the migration runner skips any file whose name is already recorded in `_migrations`:
- Modifying historical migration files (such as `007_rag_tenant_isolation.sql` or `008_rag_provenance_hardening.sql`) has **zero effect** on databases that already applied them.
- The new SQL statements in the modified file never execute on upgraded instances.
- **Rule:** Any schema repair, data cleanup, or provenance reconciliation must ALWAYS be authored as a **new, sequential forward migration** (e.g. `009_...sql`, `010_...sql`).

### 1.4 Atomic Transaction Boundaries
As hardened in AI-Foundation 1.2.2, migration execution in [server/db.ts](file:///Users/abhisheksuman/Documents/GitHub/studio/server/db.ts) guarantees atomic transactionality:
```typescript
db.transaction(() => {
  db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
})();
```
- **Atomicity guarantee:** The execution of all SQL statements within the migration file and the insertion of the migration record into `_migrations` share a single atomic SQLite transaction.
- **Rollback on error:** If any SQL statement fails (e.g. syntax error, constraint failure, duplicate column), `better-sqlite3` rolls back the entire transaction. No partial tables, columns, or indexes remain, and the migration name is **never** recorded in `_migrations`.
- **No blanket error suppression:** The runner never catches duplicate column errors or ignores SQL exceptions; it immediately throws and halts server startup with an actionable error.
- **Foreign key integrity:** Foreign keys are strictly enforced at connection creation (`db.pragma('foreign_keys = ON')`).

---

## 2. Local Backup & Verification Procedure

Always create a verified backup prior to manual operational tasks or migration testing on the authoritative database.

### 2.1 Safe Backup Creation (Live or Offline)
Use SQLite's native `.backup` command, which produces an atomic, transactionally consistent snapshot without risk of corrupting active reads:

```bash
# Derive timestamped backup filename
BACKUP_FILE="./data/studio.db.backup.$(date +%Y%m%d_%H%M%S)"

# Execute native atomic SQLite backup
sqlite3 ./data/studio.db ".backup '${BACKUP_FILE}'"
```

### 2.2 Backup Verification
Immediately verify the structural integrity and referential constraints of the backup copy:
```bash
# 1. Check structural integrity
sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;"
# Expected output: ok

# 2. Check foreign key referential integrity
sqlite3 "${BACKUP_FILE}" "PRAGMA foreign_key_check;"
# Expected output: (empty string, 0 errors)
```

### 2.3 Verification of Applied Migrations
Confirm which migrations are recorded in the backup:
```bash
sqlite3 "${BACKUP_FILE}" "SELECT name FROM _migrations ORDER BY name;"
```

---

## 3. Safe Forward-Fix Policy & Provenance Principles

### 3.1 Strict Prohibition on Manual Deletion from `_migrations`
> [!CAUTION]
> **NEVER execute `DELETE FROM _migrations WHERE name = '...'` to simulate rollback.**
> 
> Deleting a row from `_migrations` does **not** undo DDL statements (e.g. `ALTER TABLE ADD COLUMN` or `CREATE TABLE`). On subsequent application restarts, the migration runner will attempt to re-execute the migration, resulting in fatal `duplicate column` or `table already exists` crashes.

### 3.2 Untrusted Historical Seed Keys & Provenance Truth
1. **Existing `seedKey`s from Old Migrations Are NOT Authentic:**  
   In historical versions of Migration 008, `seedKey`s were assigned to legacy rows via content or title string matching. Therefore, an existing `seedKey` on a pre-existing row cannot be trusted as independent proof of canonical authorship.
2. **`ownerId IS NULL` Is NOT Proof of System Ownership:**  
   When SQLite executes `ALTER TABLE ... ADD COLUMN ownerId`, all pre-existing rows receive `ownerId = NULL`. Treating `ownerId IS NULL` as proof that a row was intended as a system default incorrectly promotes legacy private records to global defaults.
3. **Fail-Closed Reconciliation Principle:**  
   Migration 009 treats all pre-existing seed assignments as untrusted:
   - Strips historical `seedKey`s from pre-existing rows (`seedKey = NULL`).
   - De-promotes all pre-existing rows from system defaults (`isSystemDefault = 0`).
   - Quarantines all unowned rows (`isQuarantined = 1`).
   - Inserts the 12 authentic canonical application defaults with unique, immutable `seedKey`s.
   - Migration 010 closes the insertion bypass by installing a `BEFORE INSERT` trigger.

---

## 4. Operational State Classification & Reconciliation Matrix

Before undertaking recovery, identify the database's historical state:

| State | Historical Database Evolution | Migrations Executed on Startup | Behavior & Provenance Reconciliation | Converged Security State |
|:---:|---|---|---|:---:|
| **A** | **Fresh Database** (empty) | `001` through `010` | 007 adds columns; 008 adds seedKey; 009 reconciles legacy rows and inserts 12 defaults; 010 installs INSERT guard | **VERIFIED** |
| **B** | **Original 007 applied, 008 absent** | `008` → `010` | 008 adds seedKey; 009 clears false defaults, quarantines unowned, inserts 12 defaults; 010 installs INSERT guard | **VERIFIED** |
| **C** | **Original 007 AND Original 008 recorded** | `009` & `010` (007/008 skipped) | 009 strips historical seedKeys, de-promotes false defaults, quarantines unowned rows, inserts 12 canonical defaults; 010 installs INSERT guard | **VERIFIED** |
| **D** | **Corrected 007 applied, 008 absent** | `008` → `010` | 008, 009, 010 execute sequentially, ensuring 12 canonical defaults exist with all 4 triggers active | **VERIFIED** |
| **E** | **Corrected 007 AND Corrected 008 recorded** | `009` & `010` | 009 reconciles any untrusted rows, re-inserts canonical defaults; 010 installs INSERT guard | **VERIFIED** |
| **F** | **Original 008 assigned canonical `seedKey` to private row** | `009` & `010` | 009 strips the canonical key from the private row, sets `seedKey = NULL, isQuarantined = 1, isSystemDefault = 0`, inserts fresh canonical default; 010 protects against future injection | **VERIFIED** |
| **G** | **Migration 009 already applied** | `010` only | 010 executes forward migration, installs `trg_rag_prevent_canonical_insert` without modifying existing canonical or quarantined rows | **VERIFIED** |

---

## 5. Database-Level Canonical Default Protection (Triggers)

Four SQLite database triggers enforce storage-level immutability on `rag_knowledge`:

1. **`trg_rag_protect_canonical_update`** (installed by 009):  
   Blocks any direct SQL `UPDATE` against rows where `OLD.isSystemDefault = 1 OR OLD.seedKey IS NOT NULL`. Prevents modifying content, title, category, seedKey, ownerId, or system default status.
2. **`trg_rag_prevent_user_promotion_update`** (installed by 009):  
   Blocks any direct SQL `UPDATE` against private rows (`OLD.isSystemDefault = 0`) that attempts to set `NEW.isSystemDefault = 1` or `NEW.seedKey IS NOT NULL`.
3. **`trg_rag_protect_canonical_delete`** (installed by 009):  
   Blocks any direct SQL `DELETE` against rows where `OLD.isSystemDefault = 1 OR OLD.seedKey IS NOT NULL`.
4. **`trg_rag_prevent_canonical_insert`** (installed by 010):  
   Blocks any direct SQL `INSERT` where `NEW.isSystemDefault = 1 OR NEW.seedKey IS NOT NULL`. Ensures that no unverified global default or seedKey can be injected into the database outside of authorized migrations.

### Administrative Procedure for Future Canonical Default Changes
Because triggers protect canonical defaults at the SQLite engine level:
- Future modifications or additions of canonical defaults must be performed via a **new forward migration** (e.g. `011_...sql`).
- If a future migration must insert new canonical rows:
  1. Temporarily drop the INSERT guard: `DROP TRIGGER IF EXISTS trg_rag_prevent_canonical_insert;`
  2. Insert the verified canonical defaults with immutable `seedKey` values.
  3. Recreate the INSERT guard: `CREATE TRIGGER trg_rag_prevent_canonical_insert ...;`
  4. Perform all steps within the **same atomic migration transaction**.
- **Do not weaken or remove** `trg_rag_protect_canonical_update` or `trg_rag_protect_canonical_delete`.
- **Administrative Transparency:** A privileged database administrator with direct SQLite access (`sqlite3` CLI) can alter or drop triggers; the triggers are designed to prevent accidental application bugs, unintended script mutations, or API privilege escalation, not to withstand malicious root-level tampering.

---

## 6. Read-Only Diagnostic SQL Queries for Operators

Operators should run these read-only diagnostic queries to inspect database health and verify provenance integrity:

```sql
-- =========================================================================
-- Diagnostic Query Suite: Authoritative RAG Database Provenance Verification
-- =========================================================================

-- 1. Check applied migration history
SELECT name FROM _migrations ORDER BY name;

-- 2. Inspect rag_knowledge schema, columns, and indexes
PRAGMA table_info(rag_knowledge);
PRAGMA index_list(rag_knowledge);

-- =========================================================================
-- A. Expected Canonical Defaults (Must be exactly 12)
-- =========================================================================
SELECT COUNT(*) AS active_canonical_defaults_count 
FROM rag_knowledge 
WHERE isSystemDefault = 1 
  AND isQuarantined = 0 
  AND ownerId IS NULL 
  AND seedKey IN (
    'canonical_v1_alapadma_mudra',
    'canonical_v1_mayura_mudra',
    'canonical_v1_kathak_chakkars',
    'canonical_v1_flamenco_zapateado',
    'canonical_v1_afro_fusion_torso',
    'canonical_v1_contemporary_gravity',
    'canonical_v1_unbroken_eye_contact',
    'canonical_v1_silhouette_spotlight',
    'canonical_v1_impossible_accelerando',
    'canonical_v1_facial_token_anchor',
    'canonical_v1_attire_fabric_stability',
    'canonical_v1_luxury_dance_decorum'
  );
-- Expected output: 12

-- List all 12 active canonical defaults
SELECT id, seedKey, category, title 
FROM rag_knowledge 
WHERE isSystemDefault = 1 AND isQuarantined = 0 
ORDER BY id;

-- =========================================================================
-- B. Unexpected Active Global Defaults (Must be 0)
-- Detect any active global default row outside the verified allowlist
-- =========================================================================
SELECT id, seedKey, title, ownerId, isQuarantined 
FROM rag_knowledge 
WHERE isSystemDefault = 1 
  AND (
    seedKey IS NULL 
    OR seedKey NOT IN (
      'canonical_v1_alapadma_mudra',
      'canonical_v1_mayura_mudra',
      'canonical_v1_kathak_chakkars',
      'canonical_v1_flamenco_zapateado',
      'canonical_v1_afro_fusion_torso',
      'canonical_v1_contemporary_gravity',
      'canonical_v1_unbroken_eye_contact',
      'canonical_v1_silhouette_spotlight',
      'canonical_v1_impossible_accelerando',
      'canonical_v1_facial_token_anchor',
      'canonical_v1_attire_fabric_stability',
      'canonical_v1_luxury_dance_decorum'
    )
  );
-- Expected output: 0 rows

-- =========================================================================
-- C. Quarantined Legacy Records (Reported separately; not confused with defaults)
-- =========================================================================
SELECT COUNT(*) AS quarantined_legacy_count 
FROM rag_knowledge 
WHERE isQuarantined = 1;

-- Inspect quarantined rows (preserved for historical audit or manual attribution)
SELECT id, category, title, ownerId, seedKey, isSystemDefault, isQuarantined 
FROM rag_knowledge 
WHERE isQuarantined = 1 
ORDER BY id;

-- =========================================================================
-- D. Missing or Inconsistent Canonical Defaults (Must all be 0)
-- =========================================================================

-- D1. Canonical rows incorrectly marked quarantined
SELECT COUNT(*) AS canonical_quarantined_anomaly 
FROM rag_knowledge 
WHERE seedKey LIKE 'canonical_v1_%' AND isQuarantined != 0;
-- Expected output: 0

-- D2. Canonical rows without system-default status
SELECT COUNT(*) AS canonical_non_default_anomaly 
FROM rag_knowledge 
WHERE seedKey LIKE 'canonical_v1_%' AND isSystemDefault != 1;
-- Expected output: 0

-- D3. Canonical rows with an assigned owner
SELECT COUNT(*) AS canonical_owned_anomaly 
FROM rag_knowledge 
WHERE seedKey LIKE 'canonical_v1_%' AND ownerId IS NOT NULL;
-- Expected output: 0

-- D4. Duplicate canonical keys
SELECT seedKey, COUNT(*) AS occurrences 
FROM rag_knowledge 
WHERE seedKey IS NOT NULL 
GROUP BY seedKey 
HAVING COUNT(*) > 1;
-- Expected output: 0 rows

-- =========================================================================
-- E. Trigger Installation Verification (Query sqlite_master)
-- Note: Proves installation in database schema. Runtime protection is
-- separately proven by automated test suites.
-- =========================================================================
SELECT name, tbl_name 
FROM sqlite_master 
WHERE type = 'trigger' AND tbl_name = 'rag_knowledge' 
ORDER BY name;
-- Expected output:
-- trg_rag_prevent_canonical_insert      | rag_knowledge
-- trg_rag_prevent_user_promotion_update | rag_knowledge
-- trg_rag_protect_canonical_delete      | rag_knowledge
-- trg_rag_protect_canonical_update      | rag_knowledge

-- =========================================================================
-- F. Structural & Referential Integrity Checks
-- =========================================================================
PRAGMA integrity_check;
-- Expected output: ok

PRAGMA foreign_key_check;
-- Expected output: 0 rows
```

> [!WARNING]
> **Do not execute manual destructive `UPDATE` or `DELETE` statements as a first-line repair.**
> Lost ownership cannot be automatically reconstructed. Quarantined legacy records preserve their original content, categories, and tags. If manual attribution is required for a specific quarantined record, an operator may inspect audit logs and explicitly update that row's `ownerId` and set `isQuarantined = 0` via direct SQL.

---

## 7. Step-by-Step Disaster Recovery & Restore

### Step 1: Halt Application Processes
Ensure no process is actively connected to the database before modifying files:
```bash
# Verify no node/tsx processes are accessing studio.db
lsof ./data/studio.db
```

### Step 2: Preserve the Incident Database & Sidecars
Always take a snapshot of the corrupted or failing state before restoring:
```bash
INCIDENT_DIR="./data/incident_$(date +%Y%m%d_%H%M%S)"
mkdir -p "${INCIDENT_DIR}"
cp ./data/studio.db* "${INCIDENT_DIR}/"
```

### Step 3: Controlled Restore (Accounting for SQLite WAL Sidecars)
> [!IMPORTANT]
> If WAL mode was ever active, restoring `studio.db` while leaving stale `-wal` or `-shm` sidecars in place will cause SQLite to replay stale write-ahead log frames into the restored file, corrupting data.
> Never delete a live WAL containing uncheckpointed committed transactions without first halting the application.

```bash
# 1. Stop all application processes
# 2. Remove any stale WAL sidecars accompanying the target database
rm -f ./data/studio.db-wal ./data/studio.db-shm

# 3. Restore authoritative database from verified backup
cp "${BACKUP_FILE}" ./data/studio.db

# 4. Verify restored database integrity and foreign keys
sqlite3 ./data/studio.db "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

### Step 4: Fix and Re-run Migration
1. Ensure forward migrations `009_rag_provenance_reconciliation.sql` and `010_rag_default_insert_protection.sql` are present in `server/migrations/`.
2. Run automated regression tests against disposable fixtures:
   ```bash
   npx tsx --test server/test/migration_hardening.test.ts
   ```
3. Start the application and confirm clean application in `_migrations`:
   ```bash
   sqlite3 ./data/studio.db "SELECT name FROM _migrations ORDER BY name;"
   ```
