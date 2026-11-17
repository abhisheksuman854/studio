# Auravo Studio — AI-Foundation 2.3.1.4: Original Database Recovery & Safe Transfer Preparation Report

**Phase:** AI-Foundation 2.3.1.4 — Original Database Recovery & Safe Transfer Preparation  
**Date:** November 17, 2026  
**Mode:** CONTROLLED DATABASE RECOVERY INVESTIGATION  
**Repository:** `/Users/abhisheksuman/Documents/GitHub/studio`  
**Git HEAD:** `1946bb3159b672dcce250e62446029234d191283`  
**Branch:** `main`  
**Final Verdict:** `AI_FOUNDATION_2_3_1_4_RECOVERY_COPY_READY`

---

## 1. Executive Summary

Phase 2.3.1.4 successfully located, verified, and secured the original Auravo Studio SQLite database and associated storage assets.

### Key Investigation Milestones:
1. **Original Workspace Located:** The prior authoring workspace was identified in macOS Trash at `/Users/abhisheksuman/.Trash/studio/`, having been moved there on November 17, 2026 at 11:25 AM immediately prior to the fresh clone from GitHub.
2. **Authoritative Database Found & Provenance Confirmed:** Located at `/Users/abhisheksuman/.Trash/studio/data/studio.db`. The database creation/birth timestamp is **September 30, 2026, 16:01:39**, exactly matching the initial Auravo Phase 1 development period. All contained records (`users`, `brands`, `characters`, `content_ideas`, `content_items`, `assets`, etc.) carry timestamps between September 30, 2026 and October 1, 2026. The classification is **`ORIGINAL_DATABASE_CONFIRMED`**.
3. **Integrity & Schema Verified (Read-Only):** Opened strictly in read-only mode (`mode=ro`). `PRAGMA integrity_check` returned `ok`. `PRAGMA foreign_key_check` reported zero violations. The migration ledger contains migrations `001_init.sql`, `002_phase2_content_engine.sql`, and `003_phase3_quality_and_schedule.sql`.
4. **Safe WAL-Aware Online Backup Generated:** Using SQLite's official online backup API (`sqlite3.Connection.backup()`) with the source attached in read-only mode, a pristine recovery copy was created outside the Git repository at `/Users/abhisheksuman/.local/share/auravo/recovery/studio_recovered.db`. A bit-for-bit physical replica was also created at `/Users/abhisheksuman/.local/share/auravo/recovery/studio_raw_preservation.db`.
5. **Original Database Unchanged:** The SHA-256 of the source database remained completely invariant (`9147d31e468038165aec3cf3ebcbf7678572d42eb332ca4c3047ba42fef21039`) with unmodified mtime (`Nov 13 14:52:26 2026`).
6. **Active Repository Pristine:** No database in the active workspace (`data/studio.db`) was created, overwritten, or initialized. Migrations were NOT applied to the active repository.
7. **Storage Assets Discovered:** In addition to the database, the complete historical generation store was discovered intact at `/Users/abhisheksuman/.Trash/studio/data/storage/` (259 images, 37 videos, 62 audio files, 4 subtitles), including `priya_portrait.jpg`, resolving the missing test fixture identified in Phase 2.3.1.2.

---

## 2. Git State Before & After

- **Repository Path:** `/Users/abhisheksuman/Documents/GitHub/studio`
- **Active Branch:** `main`
- **Git HEAD:** `1946bb3159b672dcce250e62446029234d191283`
- **Tracked Modifications:** 0 (`git diff --stat` is empty; `git diff --cached --stat` is empty).
- **Tracked Deletions:** 0.
- **Untracked Additions:**
  - `data/database.sqlite.bak` (0 B)
  - `data/db.sqlite.bak` (0 B)
  - `database.sqlite.bak` (0 B)
  - `docs/business-audit/AI_FOUNDATION_2_3_1_1_VERIFICATION_REPORT.md`
  - `docs/business-audit/AI_FOUNDATION_2_3_1_2_VERIFICATION_REPORT.md`
  - `docs/business-audit/AI_FOUNDATION_2_3_1_3_DATABASE_PROVENANCE_REPORT.md`
  - `docs/business-audit/AI_FOUNDATION_2_3_1_4_DATABASE_RECOVERY_REPORT.md` (This document)
  - `server/coordinator/`
  - `server/migrations/011_resource_coordination.sql`
  - `server/migrations/012_resource_coordination_canonical_indexes.sql`
  - `server/test/resource_coordinator.test.ts`

Neither the recovered database nor any recovery backups were committed or placed inside the repository tree.

---

## 3. Original Workspace Search Results

Bounded searches were executed across candidate locations:
1. `/Users/abhisheksuman/Documents/GitHub/`:
   - `ai_avatar_reel` (Python/Docker project from May 2026, no `studio.db`).
   - `studio` (Current active fresh clone created Nov 17 11:25 AM).
   - No `studio.db` present in other active GitHub project directories.
2. `~/.local/share/auravo/`: Directory did not exist prior to this phase (only `mise` present under `~/.local/share`).
3. Bounded Trash Inspection:
   - macOS TCC restricts blanket directory enumeration of `~/.Trash`, but Finder AppleScript resolved the exact contents.
   - Identified item: `/Users/abhisheksuman/.Trash/studio/` (trashed on Nov 17 11:25 AM).
   - Contains: `data/`, `web/`, `server/`, `node_modules/`, `package.json`, `tsconfig.json`, `README.md`.

---

## 4. Database Candidate Inventory

| Path | Size (Bytes) | Birth Timestamp | Modification Timestamp | SHA-256 | Format / Header | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/Users/abhisheksuman/.Trash/studio/data/studio.db` | 245,760 | 2026-09-30 16:01:39 | 2026-11-13 14:52:26 | `9147d31e468038165aec3cf3ebcbf7678572d42eb332ca4c3047ba42fef21039` | SQLite 3.x (60 pages, 4096 B/page, v3049002) | **`ORIGINAL_DATABASE_CONFIRMED`** |
| `./database.sqlite` (repo root) | 0 | 2026-11-17 11:25:20 | 2026-11-17 11:25:20 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Empty file | `INVALID_EMPTY_PLACEHOLDER` |
| `./data/database.sqlite` | 0 | 2026-11-17 11:25:20 | 2026-11-17 11:25:20 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Empty file | `INVALID_EMPTY_PLACEHOLDER` |
| `./data/db.sqlite` | 0 | 2026-11-17 11:25:20 | 2026-11-17 11:25:20 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | Empty file | `INVALID_EMPTY_PLACEHOLDER` |

---

## 5. Provenance Evidence

### 5.1 Size Reconciliation (454,656 B vs 245,760 B)
- **October 3, 2026 (Phase 1C):** Size reported as 454,656 bytes ($111 \times 4096$ byte pages).
- **November 13, 2026:** Commit `b71c34c` ("updated few updates... fix: remove git tracking from local sqlite databases and gitignore sqlite files") was created at 17:50:54. At 14:52:26 on that same date (3 hours prior to commit), `data/studio.db` was accessed and vacuumed/reclaimed, reducing the page allocation from 111 pages to 60 allocated pages ($60 \times 4096 = 245,760$ bytes) with 0 freelist pages (`PRAGMA freelist_count = 0`).

### 5.2 Application Record Timestamps
All internal application records in the candidate database correlate exactly with the initial Auravo creation window:

| Table | Count | Earliest `createdAt` | Latest `createdAt` |
| :--- | :--- | :--- | :--- |
| `users` | 1 | 2026-09-30 10:32:43 | 2026-09-30 10:32:43 |
| `brands` | 1 | 2026-09-30 10:50:27 | 2026-09-30 10:50:27 |
| `audience_profiles` | 1 | 2026-09-30 10:50:27 | 2026-09-30 10:50:27 |
| `characters` | 1 | 2026-10-01 08:07:47 | 2026-10-01 08:07:47 |
| `content_ideas` | 16 | 2026-09-30 11:02:42 | 2026-09-30 11:16:46 |
| `content_items` | 4 | 2026-09-30 11:16:46 | 2026-10-01 08:16:24 |
| `scripts` | 4 | 2026-09-30 11:16:46 | 2026-10-01 08:16:24 |
| `scenes` | 20 | — | — |
| `assets` | 71 | 2026-09-30 11:16:47 | 2026-10-01 11:28:12 |
| `quality_reports` | 83 | 2026-09-30 11:17:00 | 2026-10-01 11:28:15 |
| `originality_fingerprints` | 3 | 2026-09-30 11:16:46 | 2026-09-30 11:16:46 |
| `audit_logs` | 3 | 2026-09-30 10:32:43 | 2026-09-30 10:50:27 |
| `sessions` | 3 | — | — |

*Note: Per safety protocols, personal emails, password hashes, and user tokens were not selected or displayed.*

---

## 6. SQLite Integrity & Schema Results

Executed via read-only connection (`file:...studio.db?mode=ro`):
- **`PRAGMA integrity_check`:** `ok`
- **`PRAGMA foreign_key_check`:** 0 rows returned (no foreign key violations)
- **`PRAGMA journal_mode`:** `delete`
- **`PRAGMA user_version`:** `0`
- **`PRAGMA page_size`:** `4096`
- **`PRAGMA page_count`:** `60`
- **`PRAGMA freelist_count`:** `0`

---

## 7. Migration Ledger

The `_migrations` table contains 3 records:
1. `001_init.sql`
2. `002_phase2_content_engine.sql`
3. `003_phase3_quality_and_schedule.sql`

This matches expectations: migrations `004` through `006` were committed in `b71c34c` after `studio.db` was last touched, and migrations `007` through `012` were authored subsequently.

---

## 8. WAL and Sidecar State

- **WAL Sidecar (`studio.db-wal`):** None present.
- **SHM Sidecar (`studio.db-shm`):** None present.
- **Journal Mode:** `delete`. The database was cleanly shut down without uncommitted or dangling transactions.
- **Process Lock State (`lsof`):** Zero processes currently have open file descriptors on `/Users/abhisheksuman/.Trash/studio/data/studio.db`.

---

## 9. Recovery Copy Details

A dedicated recovery directory was provisioned outside the repository:
`/Users/abhisheksuman/.local/share/auravo/recovery/`

### 9.1 Recovery Artifacts Produced
1. **Online Backup (`studio_recovered.db`):**
   - **Generation Method:** SQLite Online Backup API (`sqlite3.Connection.backup()`), connected to source via read-only URI (`mode=ro`).
   - **Absolute Path:** `/Users/abhisheksuman/.local/share/auravo/recovery/studio_recovered.db`
   - **File Size:** 245,760 bytes (60 pages)
   - **SHA-256:** `7b484002c99cae2d1e52365dea0d13feadd324ad650f3a7b3048d8818cbd6525`
   - **SQLite Version Stamp:** 3051000 (File counter 1, cookie 0x1, schema 4)
   - **Integrity Check:** `ok`
   - **Foreign Key Check:** 0 violations
   - **Table Counts:** 100% identical to source across all 15 tables.
2. **Raw Physical Replica (`studio_raw_preservation.db`):**
   - **Generation Method:** Filesystem metadata-preserving read-only copy (`shutil.copy2`).
   - **Absolute Path:** `/Users/abhisheksuman/.local/share/auravo/recovery/studio_raw_preservation.db`
   - **File Size:** 245,760 bytes
   - **SHA-256:** `9147d31e468038165aec3cf3ebcbf7678572d42eb332ca4c3047ba42fef21039` (Bit-for-bit identical to source).
   - **Integrity Check:** `ok`

---

## 10. Original Database Preservation Confirmation

Following the recovery procedure:
- **Source Path:** `/Users/abhisheksuman/.Trash/studio/data/studio.db`
- **Source SHA-256:** `9147d31e468038165aec3cf3ebcbf7678572d42eb332ca4c3047ba42fef21039` (Verified identical before and after).
- **Source Inode:** `89382861` (Unchanged).
- **Source Modification Date:** `Nov 13 14:52:26 2026` (Unchanged).
- **Zero Modifications:** The source file was never opened for writing, renamed, or moved.

---

## 11. Forward-Migration Compatibility Simulation

To ensure that transferring this database into the current application will not break on startup, a simulation was performed on a temporary copy in `/tmp`:
- Migrations simulated: `004_phase4_async_jobs.sql` through `012_resource_coordination_canonical_indexes.sql`.
- **Result:** All 9 outstanding migrations applied cleanly in sequence.
- **Post-Migration Integrity:** `PRAGMA integrity_check` returned `ok`; `PRAGMA foreign_key_check` returned 0 errors; final migration ledger contained all 12 migrations.
- The temporary simulation file was immediately removed.

---

## 12. Transfer Safety & Recommendation

### Transfer Safety Status: **SAFE TO PROCEED UPON USER APPROVAL**
- The recovery copy at `/Users/abhisheksuman/.local/share/auravo/recovery/studio_recovered.db` is verified, clean, and forward-compatible.
- In addition, the storage directory at `/Users/abhisheksuman/.Trash/studio/data/storage/` contains all 362 generation media assets (including portrait fixtures) and can safely be synchronized to `./data/storage/` upon user approval.

### Operational State of the Active Workspace:
- No database exists currently at `./data/studio.db`.
- The application was **not** started, initialized, or seeded during this phase.

---

## 13. Remaining Technical Risks

1. **Trash Emptied Risk:** If the user empties macOS Trash via Finder before moving the files, the original folder in `.Trash` will be removed. However, our recovery copies in `~/.local/share/auravo/recovery/` are safely stored outside `.Trash` on the user volume.
2. **Media Assets in Trash:** The media assets (259 images in `/Users/abhisheksuman/.Trash/studio/data/storage/images`) still reside in `.Trash`. They should be transferred to `./data/storage/` at the same time as the database.

---

## 14. Zero-Cost Confirmation

All recovery procedures, inspections, and hash verifications were executed entirely locally using standard macOS and POSIX utilities (Python standard library `sqlite3`, `shasum`, `stat`, and `sqlite3` CLI). Zero external network requests were made; zero cloud or paid services were invoked. Total expenditure: **$0.00**.

---

## 15. Final Verdict

### **`AI_FOUNDATION_2_3_1_4_RECOVERY_COPY_READY`**

*Per protocol, the original database has been discovered, verified, and safely backed up to an external recovery path. Work has stopped awaiting explicit user approval to perform the final transfer into `./data/studio.db`.*

