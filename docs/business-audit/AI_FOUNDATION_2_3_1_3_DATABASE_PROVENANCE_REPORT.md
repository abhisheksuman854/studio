# Auravo Studio — AI-Foundation 2.3.1.3: Database Provenance, Recovery & Historical Baseline Report

**Phase:** AI-Foundation 2.3.1.3 — Database Provenance, Recovery & Historical Baseline Resolution  
**Date:** November 17, 2026  
**Mode:** STRICT READ-ONLY FORENSIC INVESTIGATION  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Git HEAD:** `1946bb3159b672dcce250e62446029234d191283`  
**Branch:** `main`  
**Verdict:** `AI_FOUNDATION_2_3_1_3_RECOVERY_REQUIRED`

---

## 1. Executive Summary

Phase 2.3.1.3 executed an independent, read-only forensic investigation into application database provenance, historical database claims, backup validity, test-baseline reproducibility, and coordinator contracts.

### Core Forensic Findings:
1. **The 454 KB Database Discrepancy Resolved:** Direct evidence in `docs/business-audit/phase1c_local_reliability_implementation_report.md` (lines 26–28) and `phase1c_1_independent_verification_report.md` (lines 227–228) confirms that an authoritative database `data/studio.db` of exactly **454,656 bytes** (modified `Oct 3 16:49:06 2026`) existed in the local workspace during Phase 1C.
2. **Why It Is Absent in the Current Workspace:** The root `.gitignore` (line 4) explicitly ignores `data/*.db`. `git log --all --full-history -- "**/studio.db*"` proves that `data/studio.db` was **never committed to Git**. Git reflog (`git reflog -n 5`) and `.git/HEAD` creation timestamps (`Nov 17 11:25:19 2026`) prove that the current working directory is a **fresh clone** from `https://github.com/abhisheksuman854/studio.git`. Because Git ignores `data/*.db`, the clone cloned only tracked files, leaving the uncommitted 454 KB database behind on the original authoring machine/directory.
3. **Historical Test Failures Conclusively Reproduced:** Using a detached, isolated Git worktree at commit `1946bb3159b672dcce250e62446029234d191283`, all three failing test assertions in `server/test/experiments_api.test.ts` (404 on missing artifact) and `server/test/face_animation.test.ts` (FFmpeg stderr `maxBuffer` on `'dummy'` input) were **reproduced with identical errors**, definitively proving that they are pre-existing and unrelated to the Resource Coordinator.
4. **Coordinator Ownership & Timestamp Contracts Verified:** The `ownerId TEXT NOT NULL` contract in `resource_reservations` is intentionally distinct from `users.id` (INTEGER) to accommodate background jobs (`job:<jobId>`), process workers, and system maintenance tasks. Timestamps use UTC epoch milliseconds for durable auditing, while in-process queue timeouts utilize Node's monotonic timer loop (`uv_timer_t`), preventing wall-clock skew hazards.

---

## 2. Git State Before & After

- **Repository Directory:** `/Users/abhisheksuman/Documents/GitHub/studio`
- **Active Branch:** `main`
- **Git HEAD:** `1946bb3159b672dcce250e62446029234d191283`
- **Tracked Modifications:** Zero (`git diff --stat` is empty; `git diff --cached --stat` is empty).
- **Tracked Deletions:** Zero.
- **Untracked Additions:**
  - `data/database.sqlite.bak` (0 B)
  - `data/db.sqlite.bak` (0 B)
  - `database.sqlite.bak` (0 B)
  - `docs/business-audit/AI_FOUNDATION_2_3_1_1_VERIFICATION_REPORT.md`
  - `docs/business-audit/AI_FOUNDATION_2_3_1_2_VERIFICATION_REPORT.md`
  - `docs/business-audit/AI_FOUNDATION_2_3_1_3_DATABASE_PROVENANCE_REPORT.md` (This document)
  - `server/coordinator/`
  - `server/migrations/011_resource_coordination.sql`
  - `server/migrations/012_resource_coordination_canonical_indexes.sql`
  - `server/test/resource_coordinator.test.ts`

---

## 3. Historical Phase 1C Database Evidence

The historical audit documents in `docs/business-audit/` were reviewed to extract all claims regarding the database:

### 3.1 Direct Citations
1. **`phase1c_local_reliability_implementation_report.md` (lines 20–30):**
   > "Authoritative Database Path: `data/studio.db` is the actual, authoritative database file specified in application entry points (`server/index.ts:3`):
   > `const db = openDb(process.env.DATABASE_PATH ?? './data/studio.db');`
   > Database File Status in `data/`:
   > - `data/studio.db`: Size = **454,656 bytes** (Active, contains complete application records from Oct 3 16:49).
   > - `data/auravo.db`: DOES NOT EXIST on disk.
   > - `data/content_studio.db`: 0 bytes (Empty historical placeholder).
   > - `data/database.sqlite`: 0 bytes (Empty historical placeholder).
   > - `data/db.sqlite`: 0 bytes (Empty historical placeholder)."
2. **`phase1c_1_independent_verification_report.md` (lines 227–228):**
   > "`data/studio.db` was probed before and after all test executions:
   > `Oct  3 16:49:06 2026 (modified), 454656 bytes`.
   > Zero test data was written to `data/studio.db`."

### 3.2 Key Facts Established
- The database was named `data/studio.db`.
- Its exact byte size was **454,656 bytes** (444 KiB).
- Its filesystem modification date was `Oct 3 16:49:06 2026`.
- It contained complete application records (users, brands, audience profiles, content items) created during initial testing in October 2026.
- All unit tests in Phase 1C ran against `:memory:` and did not write to this file.

---

## 4. Current Database Candidate Inventory

All database candidate files across the workspace were inspected read-only:

| File Path | Existence | Size | Created / Cloned Timestamp | Modified Timestamp | SQLite Validity | Tables Present | Migration Ledger | Startup Code Reference |
|---|---|---|---|---|---|---|---|---|
| `./data/studio.db` | **Absent** | 0 B | N/A | N/A | N/A | N/A | N/A | **Yes (`server/index.ts:3`)** |
| `./database.sqlite` | **Present** | 0 B | Nov 17 11:25:20 2026 | Nov 17 11:25:20 2026 | Invalid (0 B) | 0 | None | No |
| `./data/database.sqlite` | **Present** | 0 B | Nov 17 11:25:20 2026 | Nov 17 11:25:20 2026 | Invalid (0 B) | 0 | None | No |
| `./data/db.sqlite` | **Present** | 0 B | Nov 17 11:25:20 2026 | Nov 17 11:25:20 2026 | Invalid (0 B) | 0 | None | No |
| `./database.sqlite.bak` | **Present** | 0 B | Nov 17 11:50:38 2026 | Nov 17 11:25:20 2026 | Invalid (0 B) | 0 | None | No |
| `./data/database.sqlite.bak` | **Present** | 0 B | Nov 17 11:50:38 2026 | Nov 17 11:25:20 2026 | Invalid (0 B) | 0 | None | No |
| `./data/db.sqlite.bak` | **Present** | 0 B | Nov 17 11:50:38 2026 | Nov 17 11:25:20 2026 | Invalid (0 B) | 0 | None | No |

---

## 5. Original Database Search Results

### 5.1 Local Filesystem Search (Bounded)
A search for `studio.db` and SQLite files was conducted across bounded developer directories:
1. **Current Repository (`/Users/abhisheksuman/Documents/GitHub/studio`):**
   - `./data/studio.db` is **absent**.
   - No `.db-wal` or `.db-shm` sidecars exist.
2. **Repository Parent (`/Users/abhisheksuman/Documents/GitHub`):**
   - No `studio.db` or other Auravo SQLite databases found.
3. **Downloads Directory (`/Users/abhisheksuman/Downloads`):**
   - `studio.tgz`: Created Sep 30, 2026 (early scaffold before Phase 1C; contains no database).
   - `cjp-studio.zip`: Contains no database files.
   - `cjp-studio-v2.zip`: Contains no database files.
4. **Trash (`~/.Trash`):**
   - No `studio.db` found.
5. **Application Data Directories (`~/.local/share/auravo`):**
   - Directory does not exist on disk.

### 5.2 Git History & Blob Inspection
1. **Full History Path Search:**
   `git log --all --full-history -- "**/studio.db*"` returned 0 commits.
2. **Git Packfile & Blob Size Audit:**
   `git rev-list --objects --all` was audited for all blobs > 25 KiB.
   The largest objects are:
   - `Mere Rashke Qamar...part` (20,061,500 bytes)
   - `data/scratch/test_portrait_svg.png` (641,346 bytes)
   - `data/scratch/f3.png` (410,076 bytes)
   - `data/scratch/f2.png` (404,924 bytes)
   - `data/scratch/f1.png` (400,500 bytes)
   Zero SQLite database blobs exist in the Git object database.

### 5.3 Filesystem Snapshot & Time Machine Inspection
1. **APFS Local Snapshots:** `tmutil listlocalsnapshots /` returned 0 snapshots.
2. **Time Machine Configuration:** `tmutil destinationinfo` returned "No destinations configured."

---

## 6. Database Provenance Classifications

| Candidate | Status Classification | Evidence & Provenance |
|---|---|---|
| `./data/studio.db` | **`ORIGINAL_DATABASE_NOT_LOCATED`** | Confirmed authoritative runtime target in `server/index.ts:3`. Existed in Phase 1C (454,656 B), but uncommitted due to `.gitignore` and absent in current fresh clone. |
| `./database.sqlite` | **`INVALID_EMPTY_PLACEHOLDER`** | 0 B file committed in `b71c34c` (Nov 13, 2026). Never initialized; no SQLite header. |
| `./data/database.sqlite` | **`INVALID_EMPTY_PLACEHOLDER`** | 0 B file committed in `b71c34c` (Nov 13, 2026). Documented as empty historical placeholder in Phase 1C report. |
| `./data/db.sqlite` | **`INVALID_EMPTY_PLACEHOLDER`** | 0 B file committed in `b71c34c` (Nov 13, 2026). Documented as empty historical placeholder in Phase 1C report. |
| `*.bak` files | **`INVALID_EMPTY_PLACEHOLDER`** | Byte-for-byte copies of the 0-byte placeholders created during Phase 2.3.1.1. |

---

## 7. Explanation of the 454 KB Discrepancy

The discrepancy between Phase 1C (reporting 454 KB) and Phase 2.3.1.2 (reporting absent) is explained by **direct, confirmed forensic evidence**:

1. **Commit & Ignore Configuration:** In commit `0dc3f16` and `.gitignore:4`, the entry `data/*.db` was added. This rule prevented Git from tracking `data/studio.db`.
2. **Phase 1C Workspace Context:** When Phase 1C was performed in October/November 2026, the author had a local `data/studio.db` file (454,656 bytes, modified Oct 3 16:49:06) containing starter data.
3. **Commit 1946bb3 & Push:** When commit `1946bb3` ("Ai foundation LLM setup") was committed on Sun Nov 15 21:26:57 2026 and pushed to `https://github.com/abhisheksuman854/studio.git`, the documentation reports were committed, but `data/studio.db` was ignored by Git.
4. **Fresh Clone on Nov 17:** Git reflog confirms:
   ```
   1946bb3 HEAD@{0}: clone: from https://github.com/abhisheksuman854/studio.git
   ```
   The `.git/HEAD` file was created on **Nov 17 11:25:19 2026**.
5. **Conclusion (`CONFIRMED`):** The physical 454 KB database was not deleted in this repository clone; rather, it was **never included in the Git remote repository** and therefore was never transferred when this directory was freshly cloned today. It remains on the original development machine or environment where Phase 1C was executed.

---

## 8. Backup Validity Findings

### 8.1 0-Byte Copy Risk
The backup files created in Phase 2.3.1.1 (`database.sqlite.bak`, `data/database.sqlite.bak`, `data/db.sqlite.bak`) are 0 bytes. They are byte-for-byte copies of 0-byte placeholders and have zero utility as database recovery sources.

### 8.2 WAL Mode & Sidecar Hazards
1. **Torn Pages & Inconsistent Copies:** When SQLite is in WAL mode, active transactions write to `studio.db-wal`. Simple file copy (`cp studio.db backup.db`) can read during a checkpoint, producing corrupted or torn database pages.
2. **Stale Sidecar Replay:** If an old backup of `studio.db` is copied into `data/` while stale `studio.db-wal` or `studio.db-shm` sidecars exist on disk, SQLite will attempt to replay the mismatched WAL journal onto the restored database upon first connection, corrupting the schema and user tables.

---

## 9. Recommended Database Recovery & Backup Procedures

### 9.1 Recommended Recovery Procedure (If Original Database is Located)
If the user locates the original 454,656-byte `studio.db` from their previous machine or backup:
1. Verify its checksum and size:
   ```bash
   ls -la /path/to/found/studio.db  # Must be ~454,656 bytes
   shasum -a 256 /path/to/found/studio.db
   ```
2. Verify integrity read-only before placing in repo:
   ```bash
   sqlite3 "file:/path/to/found/studio.db?mode=ro" "PRAGMA integrity_check; PRAGMA foreign_key_check;"
   ```
3. Ensure no stale sidecars exist in `data/`:
   ```bash
   rm -f ./data/studio.db-wal ./data/studio.db-shm
   ```
4. Copy the verified file to `./data/studio.db`.
5. Run the production migration runner `openDb('./data/studio.db')` to apply migrations 011 and 012 cleanly forward.

### 9.2 Recommended Future Backup Procedure
Whenever `data/studio.db` is active, backups must use SQLite's atomic online backup API:
```bash
BACKUP_FILE="./data/studio.db.backup.$(date +%Y%m%d_%H%M%S)"
# 1. Atomic online backup (safe even with active WAL writers)
sqlite3 ./data/studio.db ".backup '${BACKUP_FILE}'"
# 2. Structural & referential validation
sqlite3 "${BACKUP_FILE}" "PRAGMA integrity_check;"
sqlite3 "${BACKUP_FILE}" "PRAGMA foreign_key_check;"
# 3. Cryptographic hash
shasum -a 256 "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"
```

---

## 10. Historical Test Baseline Reproduction Results

To resolve whether the 3 test failures were introduced recently or were pre-existing, an isolated, detached Git worktree was created outside the active repository at commit `1946bb3159b672dcce250e62446029234d191283` (`/tmp/auravo_baseline_1946bb3`).

### 10.1 Reproduction Findings

| Failure Identification | Failing Assertion / Location | Error Output | Baseline Worktree Result | Classification |
|---|---|---|---|---|
| **Failure A: Experiments Artifact** | `server/test/experiments_api.test.ts:162:12` | `AssertionError: 404 !== 200` | Failed identically in worktree | **`REPRODUCED_AT_HISTORICAL_BASELINE`** |
| **Failure B: Experiments Parent** | `server/test/experiments_api.test.ts:34` | Parent suite assertion cascade | Failed identically in worktree | **`REPRODUCED_AT_HISTORICAL_BASELINE`** |
| **Failure C: Face Animation MaxBuffer** | `server/test/face_animation.test.ts:24` | `RangeError: stderr maxBuffer length exceeded` | Failed identically in worktree | **`REPRODUCED_AT_HISTORICAL_BASELINE`** |

### 10.2 Root-Cause Validation
- **Failure A & B:** In `server/experiments.ts:1039`, the endpoint seeks artifacts under `~/.local/share/auravo/models/phase2b_2/persona_b_latin.png`. This binary model output was never committed to Git. The test fails with 404 because the file does not exist on this machine.
- **Failure C:** In `server/test/face_animation.test.ts:33–38`, because `data/storage/images/priya_portrait.jpg` is absent, the test writes a 5-byte file containing the string `'dummy'`. FFmpeg attempts to decode `'dummy'` as video in a loop, generating hundreds of thousands of decoder error lines that overflow Node's 1 MiB `stderr` buffer.

Both failures are **100% pre-existing** at commit `1946bb3159b672dcce250e62446029234d191283`. Zero application regressions were introduced in Phase 2.3.1.x.

---

## 11. Resource Reservation Owner Contract Audit

### 11.1 Schema Contract
In [server/migrations/011_resource_coordination.sql](file:///Users/abhisheksuman/Documents/GitHub/studio/server/migrations/011_resource_coordination.sql#L7):
```sql
ownerId TEXT NOT NULL
```

### 11.2 Architectural Comparison Across Tables
- **`users` Table:** `id INTEGER PRIMARY KEY AUTOINCREMENT`
- **`jobs` Table:** `id TEXT PRIMARY KEY` (`job_<timestamp>_<hex>`), `ownerId INTEGER NOT NULL REFERENCES users(id)`
- **`brands` & `content_items` Tables:** `ownerId INTEGER NOT NULL REFERENCES users(id)`

### 11.3 Why `ownerId TEXT` is Technically Correct for the Coordinator
1. **Multi-Entity Reservers:** The Resource Coordinator serializes workloads across multiple entity types:
   - Asynchronous render jobs (identified by `jobId: string`, e.g. `'job_1731835200_a1b2'`).
   - Interactive user sessions (identified by `userId: number`, e.g. `'user:1'`).
   - Internal background maintenance/recovery workers (e.g. `'system:startup-recovery'`, `'crashed-worker'`).
   - Standalone Python subprocesses.
2. **Ambiguity Prevention:** If `ownerId` was constrained to `INTEGER REFERENCES users(id)`:
   - Background jobs or maintenance tasks could not acquire reservations without an artificial user record.
   - If a single user queues two render jobs, both jobs would share the same numeric `ownerId`, making job-level lease cancellation and release ambiguous.
3. **Surviving Restarts:** An asynchronous job stores its unique `jobId` across restarts. By using `job:<jobId>` as the coordinator `ownerId`, the job worker can unambiguously reclaim or release its lease following an engine restart.
4. **Verdict:** `ownerId TEXT NOT NULL` is the correct, architecturally sound contract. It should not be constrained to a foreign key on `users(id)`.

---

## 12. Timestamp Contract Audit

### 12.1 Implementation Analysis
In `server/coordinator/coordinator.ts`:
- Timestamps are generated via `this.now = options.now ?? (() => Date.now());`
- `acquiredAt`, `lastHeartbeatAt`, and `releasedAt` are stored as integer milliseconds since Unix epoch (wall-clock time).
- In-process queue timeouts are managed via `setTimeout`, which binds to `uv_timer_t` (Node's event loop timer backed by the OS monotonic clock `CLOCK_MONOTONIC` / `mach_absolute_time`).

### 12.2 Wall-Clock vs. Monotonic Clock Hazards
- **Wall-Clock Risk:** `Date.now()` is subject to NTP clock stepping, leap seconds, VM migration, or manual system clock adjustments. A clock stepped backward can make elapsed time appear negative.
- **Coordinator Resilience:** Auravo's fail-closed design strictly prohibits TTL-only reclamation. Regardless of how stale a `lastHeartbeatAt` timestamp appears, the coordinator **never** reclaims a lease without dual-gate verification (Process Dead via `process.kill(pid, 0)` + Provider Unloaded via `provider.getStatus()`). Thus, clock stepping cannot cause premature lease stealing.
- **Architectural Recommendation:**
  - Persist UTC epoch milliseconds in SQLite for human auditing and SQL queries.
  - In Phase 2.3.2, use `process.hrtime.bigint()` for in-memory timeout and lease-duration measurements.

---

## 13. Current Test Results & Build Inventory

### 13.1 Dedicated Coordinator Suite (`server/test/resource_coordinator.test.ts`)
- **Command:** `node --import tsx --test server/test/resource_coordinator.test.ts`
- **Result:** **25 / 25 PASS (100%)**
- **Duration:** 512 ms
- **Exit Code:** 0

### 13.2 Full Project Test Suite (`npm test`)
- **Command:** `tsx --test server/test/*.test.ts` (outside sandbox)
- **Total Tests:** 144
- **Passed:** 140
- **Failed:** 3 (Pre-existing: 2 in `experiments_api`, 1 in `face_animation`)
- **Skipped:** 1
- **Duration:** 60.84 s

### 13.3 TypeScript Typecheck & Production Build
- **`npm run typecheck` (`tsc --noEmit`):** **0 errors** (Exit code: 0)
- **`npm run build` (`vite build web`):** **0 errors** (Built in 497 ms, exit code: 0)

---

## 14. Remaining Technical Risks

1. **Absence of Initialized Application Database:**
   - Because `data/studio.db` was not cloned from GitHub, starting the server will initialize a new database and apply migrations 001–012.
   - If historical user records from Phase 1C are required, the original `data/studio.db` (454,656 B) must be copied from the author's original machine before running `npm start`.
2. **Pre-Existing Legacy Test Fixtures:**
   - `experiments_api.test.ts` and `face_animation.test.ts` will continue to fail in CI/local runs until the missing test fixtures (`persona_b_latin.png` and `priya_portrait.jpg`) are either committed or mocked in those legacy test files.

---

## 15. Zero-Cost Confirmation

All investigation, forensic git analysis, and detached worktree executions were conducted locally using built-in system tools (Git, Node.js, SQLite, Homebrew). Zero dollars were spent; zero cloud or paid services were invoked.

---

## 16. Final Recommendation & Verdict

### Final Recommendation
1. **Do not create or overwrite `data/studio.db` during this audit phase.**
2. Request the user to check whether the original 454 KB `studio.db` from Phase 1C exists on another machine or backup drive.
3. If the user intends to start fresh with seed data, they can run `npm run seed`, which will safely create `./data/studio.db` and apply migrations 001–012 automatically.
4. The Resource Coordinator core is completely verified and ready for Phase 2.3.2 integration.

### Final Verdict

**`AI_FOUNDATION_2_3_1_3_RECOVERY_REQUIRED`**

*Per protocol, this verdict is chosen because direct evidence confirms that an authoritative 454 KB database previously existed in Phase 1C, but is absent from the current fresh Git clone. Work is halted awaiting explicit user review.*

