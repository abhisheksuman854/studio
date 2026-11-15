import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { RAGEngine, SEED_RAG_KNOWLEDGE } from '../providers/rag_engine.js';
import { LocalLLMProvider } from '../providers/llm.js';
import type { BrandContext, CharacterContext, GeneratedStory } from '../providers/types.js';

function makeClient(base: string, initialCookie = '') {
  let cookie = initialCookie;
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return {
      status: r.status,
      body: r.status === 204 ? null : await r.json(),
    };
  };
}

// =========================================================================
// Workstream B: Production Migration Runner Execution & Provenance Safety
// =========================================================================

test('Workstream B - Pre-007 Legacy Upgrade through Real openDb() Runner', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `pre007_upgrade_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);

  t.after(() => {
    try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {}
  });

  // 1. Construct a pre-007 legacy database (applied migrations 001 - 006)
  const db = new Database(testDbFile);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');

  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '007') continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }

  // Seed fixture records in pre-007 schema (which has NO ownerId column):
  // 1. Private record whose title matches canonical Alapadma Mudra, different content
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata)
    VALUES (1, 'CHOREOGRAPHY', 'Alapadma Mudra (Blooming Lotus)', 'Legacy private user lotus content DiffCode111', '["lotus"]', '{"author":"UserA"}')
  `).run();

  // 2. Private record with matching category & title
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata)
    VALUES (2, 'CHOREOGRAPHY', 'Kathak Chakkars (High-Speed Pirouettes)', 'Legacy private user spin content DiffCode222', '["spin"]', '{"author":"UserB"}')
  `).run();

  // 3. Legacy record with exact matching category, title, and content to canonical Flamenco Zapateado
  const flamencoSeed = SEED_RAG_KNOWLEDGE.find((s) => s.title.includes('Flamenco Zapateado'))!;
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata)
    VALUES (3, ?, ?, ?, ?, ?)
  `).run(flamencoSeed.category, flamencoSeed.title, flamencoSeed.content, JSON.stringify(flamencoSeed.tags), JSON.stringify(flamencoSeed.metadata || {}));

  // 4. Unrelated legacy record
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata)
    VALUES (4, 'VIRAL_HOOKS', 'Ancient Mystery Dance Hook', 'Unknown hook content MysteryCode444', '["mystery"]', '{}')
  `).run();

  db.close();

  // 2. Run the REAL production migration runner openDb() to apply 007 and 008 sequentially
  // NO manual SQL intervention between migrations!
  const upgradedDb = openDb(testDbFile);

  // Assertions on legacy records:
  // Legacy record 1: Title match, different content
  const row1 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 1').get() as any;
  assert.equal(row1.isSystemDefault, 0, 'Legacy title-matching record must NOT be promoted to system default');
  assert.equal(row1.isQuarantined, 1, 'Legacy unowned record must fail closed to quarantine');
  assert.equal(row1.seedKey, null, 'Legacy record must not receive seedKey');
  assert.equal(row1.title, 'Alapadma Mudra (Blooming Lotus)', 'Original title preserved');
  assert.equal(row1.content, 'Legacy private user lotus content DiffCode111', 'Original content preserved');

  // Legacy record 2: Title and category match
  const row2 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 2').get() as any;
  assert.equal(row2.isSystemDefault, 0, 'Legacy record must NOT be system default');
  assert.equal(row2.isQuarantined, 1, 'Legacy record must be quarantined');
  assert.equal(row2.seedKey, null);

  // Legacy record 3: Exact title, category, AND content match to canonical seed
  const row3 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 3').get() as any;
  assert.equal(row3.isSystemDefault, 0, 'Legacy record with identical content must NOT be adopted as system default');
  assert.equal(row3.isQuarantined, 1, 'Legacy record with identical content must fail closed to quarantine');
  assert.equal(row3.seedKey, null, 'Legacy record must NOT receive canonical seedKey');

  // Legacy record 4: Unrelated legacy record
  const row4 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 4').get() as any;
  assert.equal(row4.isSystemDefault, 0);
  assert.equal(row4.isQuarantined, 1);
  assert.equal(row4.seedKey, null);

  // Canonical defaults: Exactly 12 application-owned defaults inserted with seedKeys
  const canonicalDefaults = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(canonicalDefaults.length, 12, 'Must have exactly 12 verified system defaults');
  assert.ok(canonicalDefaults.every((d) => d.ownerId === null && d.isQuarantined === 0 && d.seedKey?.startsWith('canonical_v1_')));

  // Canonical Flamenco Zapateado is a separate distinct row with its own seedKey
  const canonicalFlamenco = upgradedDb.prepare("SELECT * FROM rag_knowledge WHERE seedKey = 'canonical_v1_flamenco_zapateado'").get() as any;
  assert.ok(canonicalFlamenco, 'Canonical Flamenco must exist');
  assert.notEqual(canonicalFlamenco.id, 3, 'Canonical default must be distinct from legacy row 3');

  // Database integrity checks
  const integrity = upgradedDb.pragma('integrity_check') as any[];
  assert.equal(integrity[0].integrity_check, 'ok');
  const fkCheck = upgradedDb.pragma('foreign_key_check') as any[];
  assert.equal(fkCheck.length, 0);

  upgradedDb.close();
});

test('Workstream B - Post-007 Existing DB Upgrade with User Ownership & Collision Coexistence', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `post007_upgrade_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);

  t.after(() => {
    try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {}
  });

  // Construct a database that has applied 001 through 007
  const db = new Database(testDbFile);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');

  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '008') continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }

  // Create users 201, 202, 203
  db.prepare('INSERT INTO users(id, email, passwordHash) VALUES(201, ?, ?)').run('user201@example.com', 'h1');
  db.prepare('INSERT INTO users(id, email, passwordHash) VALUES(202, ?, ?)').run('user202@example.com', 'h2');
  db.prepare('INSERT INTO users(id, email, passwordHash) VALUES(203, ?, ?)').run('user203@example.com', 'h3');

  // User 201 created a private record with title matching canonical Alapadma
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
    VALUES (10, 'CHOREOGRAPHY', 'Alapadma Mudra (Blooming Lotus)', 'User 201 Private Lotus Routine Code999', '["lotus"]', '{}', 201, 0, 0)
  `).run();

  // User 202 created a private record with category and title matching canonical Mayura
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
    VALUES (20, 'CHOREOGRAPHY', 'Mayura Mudra (Peacock Grace)', 'User 202 Private Peacock Routine Code888', '["mayura"]', '{}', 202, 0, 0)
  `).run();

  // User 203 created a private record with matching title, category, AND exact content
  const mudraSeed = SEED_RAG_KNOWLEDGE.find((s) => s.title.includes('Mayura'))!;
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
    VALUES (30, ?, ?, ?, ?, '{}', 203, 0, 0)
  `).run(mudraSeed.category, mudraSeed.title, mudraSeed.content, JSON.stringify(mudraSeed.tags));

  // A record that had previously been wrongly promoted by old 007 without ownerId
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
    VALUES (40, 'CHOREOGRAPHY', 'Kathak Chakkars (High-Speed Pirouettes)', 'Corrupted Unverified Pirouette', '[]', '{}', NULL, 1, 0)
  `).run();

  db.close();

  // Run the REAL production migration runner to apply 008
  const upgradedDb = openDb(testDbFile);

  // Assertions:
  // User 201 record retains ownership and remains private
  const u201 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 10').get() as any;
  assert.equal(u201.ownerId, 201, 'User 201 ownership must be preserved');
  assert.equal(u201.isSystemDefault, 0, 'User 201 record must NOT be system default');
  assert.equal(u201.isQuarantined, 0, 'User 201 record must not be quarantined');
  assert.equal(u201.seedKey, null);

  // User 202 record retains ownership and remains private
  const u202 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 20').get() as any;
  assert.equal(u202.ownerId, 202, 'User 202 ownership must be preserved');
  assert.equal(u202.isSystemDefault, 0);
  assert.equal(u202.isQuarantined, 0);

  // User 203 record retains ownership and remains private even with identical content
  const u203 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 30').get() as any;
  assert.equal(u203.ownerId, 203, 'User 203 ownership must be preserved');
  assert.equal(u203.isSystemDefault, 0, 'User 203 record must NOT be converted to system default');
  assert.equal(u203.isQuarantined, 0);
  assert.equal(u203.seedKey, null);

  // The unowned record that old 007 had promoted is de-promoted and quarantined
  const dePromoted = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 40').get() as any;
  assert.equal(dePromoted.isSystemDefault, 0, 'Unverified row must be de-promoted from system default');
  assert.equal(dePromoted.isQuarantined, 1, 'Unverified row must be quarantined');
  assert.equal(dePromoted.seedKey, null);

  // Canonical defaults are present with seedKey
  const canonicalMayura = upgradedDb.prepare("SELECT * FROM rag_knowledge WHERE seedKey = 'canonical_v1_mayura_mudra'").get() as any;
  assert.ok(canonicalMayura);
  assert.equal(canonicalMayura.isSystemDefault, 1);
  assert.equal(canonicalMayura.ownerId, null);
  assert.notEqual(canonicalMayura.id, 20, 'Canonical default must be distinct from User 202 row');
  assert.notEqual(canonicalMayura.id, 30, 'Canonical default must be distinct from User 203 row');

  // Multi-tenant search isolation via RAGEngine
  const rag = new RAGEngine(upgradedDb);
  const u201Search = rag.search('lotus blooming', { userId: 201 });
  assert.ok(u201Search.some((r) => r.item.id === 10), 'User 201 sees their private record');
  assert.ok(u201Search.some((r) => r.item.isSystemDefault), 'User 201 sees canonical default');

  const u202Search = rag.search('lotus blooming', { userId: 202 });
  assert.ok(!u202Search.some((r) => r.item.id === 10), 'User 202 CANNOT see User 201 private record');
  assert.ok(u202Search.some((r) => r.item.isSystemDefault), 'User 202 sees canonical default');

  // Idempotency: re-running openDb does not duplicate rows or change ownership
  const countBefore = (upgradedDb.prepare('SELECT COUNT(*) c FROM rag_knowledge').get() as { c: number }).c;
  upgradedDb.close();
  const dbReopened = openDb(testDbFile);
  const countAfter = (dbReopened.prepare('SELECT COUNT(*) c FROM rag_knowledge').get() as { c: number }).c;
  assert.equal(countBefore, countAfter, 'Reopening DB must not duplicate records');

  dbReopened.close();
});

test('Workstream B - Clean Empty Database Migration to 008', () => {
  const db = openDb(':memory:');
  const rag = new RAGEngine(db);

  const defaults = rag.listKnowledge();
  assert.equal(defaults.length, 12, 'Must have exactly 12 verified defaults');
  assert.ok(defaults.every((d) => d.isSystemDefault && !d.isQuarantined && d.seedKey?.startsWith('canonical_v1_')));

  const integrity = db.pragma('integrity_check') as any[];
  assert.equal(integrity[0].integrity_check, 'ok');
  const fkCheck = db.pragma('foreign_key_check') as any[];
  assert.equal(fkCheck.length, 0);

  db.close();
});

// =========================================================================
// Workstream C: Production Migration Runner Failure & Rollback Test
// =========================================================================

test('Workstream C - Production openDb() Runner Failure Rollback & Restart Recovery', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  const tempFixtureDir = path.join(scratchDir, `mig_fixture_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempFixtureDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `mig_runner_fail_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);

  t.after(() => {
    try { fs.rmSync(tempFixtureDir, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {}
  });

  // 1. Create fixture migrations:
  // 001_valid: valid table
  fs.writeFileSync(path.join(tempFixtureDir, '001_valid.sql'), `
    CREATE TABLE fixture_valid_table (id INTEGER PRIMARY KEY, title TEXT);
  `);

  // 002_failing: statement 1 succeeds, statement 2 fails with fatal syntax/table error
  fs.writeFileSync(path.join(tempFixtureDir, '002_failing.sql'), `
    CREATE TABLE fixture_partial_table (id INTEGER PRIMARY KEY);
    INSERT INTO non_existent_dummy_table_999 VALUES (1);
  `);

  // 003_later: should never execute
  fs.writeFileSync(path.join(tempFixtureDir, '003_later.sql'), `
    CREATE TABLE fixture_never_reached_table (id INTEGER PRIMARY KEY);
  `);

  // 2. Execute the ACTUAL production openDb(testDbFile, tempFixtureDir)
  let runnerThrew = false;
  try {
    openDb(testDbFile, tempFixtureDir);
  } catch (err: any) {
    runnerThrew = true;
    assert.ok(err.message.includes('no such table') || err.message.includes('non_existent_dummy_table_999'));
  }
  assert.equal(runnerThrew, true, 'openDb() must throw when a migration statement fails');

  // Verify failure state in the actual SQLite database file:
  const inspectDb = new Database(testDbFile);

  // 001_valid completed and is recorded in _migrations
  const mig001 = inspectDb.prepare("SELECT 1 FROM _migrations WHERE name = '001_valid.sql'").get();
  assert.ok(mig001, '001_valid.sql must be recorded in _migrations');
  const validTable = inspectDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fixture_valid_table'").get();
  assert.ok(validTable, 'fixture_valid_table must exist');

  // 002_failing: all statements rolled back; NOT in _migrations
  const mig002 = inspectDb.prepare("SELECT 1 FROM _migrations WHERE name = '002_failing.sql'").get();
  assert.equal(mig002, undefined, '002_failing.sql must NOT be recorded in _migrations');
  const partialTable = inspectDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fixture_partial_table'").get();
  assert.equal(partialTable, undefined, 'fixture_partial_table must have been rolled back by transaction');

  // 003_later: was never reached
  const mig003 = inspectDb.prepare("SELECT 1 FROM _migrations WHERE name = '003_later.sql'").get();
  assert.equal(mig003, undefined, '003_later.sql must NOT be recorded in _migrations');
  const neverTable = inspectDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fixture_never_reached_table'").get();
  assert.equal(neverTable, undefined, 'fixture_never_reached_table must never have run');

  inspectDb.close();

  // 3. Fix the failing migration in the fixture directory
  fs.writeFileSync(path.join(tempFixtureDir, '002_failing.sql'), `
    CREATE TABLE fixture_partial_table (id INTEGER PRIMARY KEY, status TEXT);
  `);

  // 4. Restart: re-invoke production openDb() on the same database
  const recoveredDb = openDb(testDbFile, tempFixtureDir);

  // Now both 002 and 003 must be recorded and tables created
  const migs = recoveredDb.prepare('SELECT name FROM _migrations ORDER BY name').all() as { name: string }[];
  assert.deepEqual(migs.map((m) => m.name), ['001_valid.sql', '002_failing.sql', '003_later.sql']);

  const table002 = recoveredDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fixture_partial_table'").get();
  assert.ok(table002, 'fixture_partial_table must exist after recovery');

  const table003 = recoveredDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fixture_never_reached_table'").get();
  assert.ok(table003, 'fixture_never_reached_table must exist after recovery');

  recoveredDb.close();
});

// =========================================================================
// Workstream E: HTTP-Level Story Generation Identity Propagation Test
// =========================================================================

test('Workstream E - HTTP Story Generation Identity Propagation & RAG Isolation', async (t) => {
  const db = openDb(':memory:');

  // Capture spy
  let lastCapturedUserId: number | undefined;

  class SpyLLMProvider extends LocalLLMProvider {
    async generateStory(
      brand: BrandContext,
      topic: string,
      customPremise?: string,
      character?: CharacterContext,
      userId?: number
    ): Promise<GeneratedStory> {
      lastCapturedUserId = userId;
      return super.generateStory(brand, topic, customPremise, character, userId);
    }
  }

  const ragEngine = new RAGEngine(db);
  const spyLLM = new SpyLLMProvider(ragEngine);

  const app = createApp(db, { providers: { llm: spyLLM, ragEngine } });
  const srv = app.listen(0);
  const port = (srv.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  t.after(() => {
    srv.close();
    db.close();
  });

  // 1. Unauthenticated request to /api/content/custom is rejected with 401
  await t.test('Unauthenticated story generation rejected with 401', async () => {
    const unauth = makeClient(base);
    const res = await unauth('POST', '/api/content/custom', {
      brandId: 1,
      title: 'Story',
      premise: 'Premise',
    });
    assert.equal(res.status, 401);
  });

  // Setup User A via registration
  const clientA = makeClient(base);
  const regA = await clientA('POST', '/api/auth/register', { email: 'usera_story2@example.com', password: 'password123' });
  assert.equal(regA.status, 201);
  const userAId = (regA.body as any).id;

  const brandARes = db.prepare(`
    INSERT INTO brands (ownerId, name, handle, description, tone, visualStyle, niche, contentRules, prohibitedTopics, preferredTopics, secondaryLanguages)
    VALUES (?, 'Studio A', '@studio.a', 'Brand A', 'dramatic', 'theatrical', 'Kathak', 'rules', '[]', '[]', '[]')
  `).run(userAId);
  const brandAId = Number(brandARes.lastInsertRowid);

  // Setup User B directly in SQLite sessions
  const userBToken = crypto.randomBytes(32).toString('hex');
  const userBId = db.prepare('INSERT INTO users(email, passwordHash) VALUES(?, ?)').run('userb_story2@example.com', 'hashb').lastInsertRowid as number;
  db.prepare('INSERT INTO sessions VALUES(?, ?, ?)').run(
    crypto.createHash('sha256').update(userBToken).digest('hex'),
    userBId,
    Date.now() + 7 * 864e5
  );
  const clientB = makeClient(base, `sid=${userBToken}`);

  const brandBRes = db.prepare(`
    INSERT INTO brands (ownerId, name, handle, description, tone, visualStyle, niche, contentRules, prohibitedTopics, preferredTopics, secondaryLanguages)
    VALUES (?, 'Studio B', '@studio.b', 'Brand B', 'dramatic', 'theatrical', 'Kathak', 'rules', '[]', '[]', '[]')
  `).run(userBId);
  const brandBId = Number(brandBRes.lastInsertRowid);

  // User A creates a secret private choreography record in RAG
  const secretCode = 'SuperSecretSpinA99';
  const privateItemRes = await clientA('POST', '/api/rag/knowledge', {
    category: 'CHOREOGRAPHY',
    title: 'User A Top Secret Spinning Technique',
    content: `A proprietary spin technique incorporating ${secretCode} for User A only.`,
    tags: ['secret', 'spin', 'kathak'],
  });
  assert.equal(privateItemRes.status, 201);

  // 2. User B invokes story generation through HTTP POST /api/content/custom
  await t.test('User B HTTP story generation passes userBId and isolates private RAG', async () => {
    lastCapturedUserId = undefined;

    const resB = await clientB('POST', '/api/content/custom', {
      brandId: brandBId,
      title: 'Kathak Spin Routine',
      premise: 'Dancer performs a spin routine',
      ownerId: userAId, // Attempt client-side ownerId spoofing
    });

    assert.equal(resB.status, 201);
    assert.equal(lastCapturedUserId, userBId, 'LLM must receive authenticated User B id');
    assert.notEqual(lastCapturedUserId, userAId, 'LLM must NOT receive spoofed User A id');

    const storyB = (resB.body as any).story;
    const leakedIntoB = storyB.scenes.some(
      (s: any) => s.visualPrompt.includes(secretCode) || s.narration.includes(secretCode)
    );
    assert.equal(leakedIntoB, false, 'User A secret RAG code leaked into User B generated story via HTTP!');
  });

  // 3. User A invokes story generation through HTTP POST /api/content/custom
  await t.test('User A HTTP story generation passes userAId and retrieves User A private RAG', async () => {
    lastCapturedUserId = undefined;

    const resA = await clientA('POST', '/api/content/custom', {
      brandId: brandAId,
      title: 'Kathak Spin Routine',
      premise: 'Dancer performs a spin routine',
    });

    assert.equal(resA.status, 201);
    assert.equal(lastCapturedUserId, userAId, 'LLM must receive authenticated User A id');

    const storyA = (resA.body as any).story;
    const retrievedInA = storyA.scenes.some(
      (s: any) => s.visualPrompt.includes(secretCode) || s.visualPrompt.includes('Secret Spinning')
    );
    assert.equal(retrievedInA, true, 'User A should retrieve their own private RAG knowledge in story prompt');
  });
});

// =========================================================================
// Workstream B: Database Triggers Direct SQL Protection & User CRUD
// =========================================================================

test('Workstream B - Database Triggers Enforce Immutability & Reject Direct SQL Tampering', () => {
  const db = openDb(':memory:');
  const rag = new RAGEngine(db);

  // 1. Direct SQL UPDATE on canonical default content is rejected by trigger
  assert.throws(
    () => {
      db.prepare("UPDATE rag_knowledge SET content = 'Malicious Content' WHERE seedKey = 'canonical_v1_alapadma_mudra'").run();
    },
    (err: any) => {
      assert.match(err.message, /Canonical system default knowledge items are immutable and cannot be updated/);
      return true;
    }
  );

  // 2. Direct SQL UPDATE on canonical default seedKey is rejected
  assert.throws(
    () => {
      db.prepare("UPDATE rag_knowledge SET seedKey = 'tampered_key' WHERE seedKey = 'canonical_v1_alapadma_mudra'").run();
    },
    (err: any) => {
      assert.match(err.message, /Canonical system default knowledge items are immutable and cannot be updated/);
      return true;
    }
  );

  // 3. Direct SQL UPDATE on canonical default ownership/system-default status is rejected
  assert.throws(
    () => {
      db.prepare("UPDATE rag_knowledge SET ownerId = 999, isSystemDefault = 0 WHERE seedKey = 'canonical_v1_alapadma_mudra'").run();
    },
    (err: any) => {
      assert.match(err.message, /Canonical system default knowledge items are immutable and cannot be updated/);
      return true;
    }
  );

  // 4. Direct SQL DELETE of canonical default is rejected
  assert.throws(
    () => {
      db.prepare("DELETE FROM rag_knowledge WHERE seedKey = 'canonical_v1_alapadma_mudra'").run();
    },
    (err: any) => {
      assert.match(err.message, /Canonical system default knowledge items cannot be deleted/);
      return true;
    }
  );

  // 5. Create a user-owned private record (after inserting user in users table)
  db.prepare('INSERT INTO users(id, email, passwordHash) VALUES(501, ?, ?)').run('user501@example.com', 'h501');
  const insertUserRes = db.prepare(`
    INSERT INTO rag_knowledge (category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined, seedKey)
    VALUES ('CHOREOGRAPHY', 'Private Dance Technique', 'Original private content', '["test"]', '{}', 501, 0, 0, NULL)
  `).run();
  const privateId = Number(insertUserRes.lastInsertRowid);

  // 6. Direct SQL attempt to promote private record to system default is rejected by trigger
  assert.throws(
    () => {
      db.prepare('UPDATE rag_knowledge SET isSystemDefault = 1 WHERE id = ?').run(privateId);
    },
    (err: any) => {
      assert.match(err.message, /Cannot promote private knowledge items to system defaults or assign seed keys/);
      return true;
    }
  );

  // 7. Direct SQL attempt to assign seedKey to private record is rejected by trigger
  assert.throws(
    () => {
      db.prepare("UPDATE rag_knowledge SET seedKey = 'canonical_v1_spoofed' WHERE id = ?").run(privateId);
    },
    (err: any) => {
      assert.match(err.message, /Cannot promote private knowledge items to system defaults or assign seed keys/);
      return true;
    }
  );

  // 8. Normal authenticated update to private record succeeds
  db.prepare("UPDATE rag_knowledge SET title = 'Updated Title', content = 'Updated Content' WHERE id = ? AND ownerId = 501").run(privateId);
  const updatedRow = db.prepare('SELECT title, content FROM rag_knowledge WHERE id = ?').get(privateId) as any;
  assert.equal(updatedRow.title, 'Updated Title');
  assert.equal(updatedRow.content, 'Updated Content');

  // 9. Normal authenticated delete of private record succeeds
  db.prepare('DELETE FROM rag_knowledge WHERE id = ? AND ownerId = 501').run(privateId);
  const deletedRow = db.prepare('SELECT id FROM rag_knowledge WHERE id = ?').get(privateId);
  assert.equal(deletedRow, undefined);

  // 10. Direct SQL INSERT with isSystemDefault = 1, seedKey = NULL is rejected by trigger
  assert.throws(
    () => {
      db.prepare(`
        INSERT INTO rag_knowledge (category, title, content, isSystemDefault, seedKey)
        VALUES ('CHOREOGRAPHY', 'Spoofed Default 1', 'Content', 1, NULL)
      `).run();
    },
    (err: any) => {
      assert.match(err.message, /Direct insertion of canonical system defaults or seed keys is prohibited/);
      return true;
    }
  );

  // 11. Direct SQL INSERT with isSystemDefault = 0, non-null seedKey is rejected by trigger
  assert.throws(
    () => {
      db.prepare(`
        INSERT INTO rag_knowledge (category, title, content, isSystemDefault, seedKey)
        VALUES ('CHOREOGRAPHY', 'Spoofed SeedKey 2', 'Content', 0, 'some_seed_key')
      `).run();
    },
    (err: any) => {
      assert.match(err.message, /Direct insertion of canonical system defaults or seed keys is prohibited/);
      return true;
    }
  );

  // 12. Direct SQL INSERT with isSystemDefault = 1, non-null seedKey is rejected by trigger
  assert.throws(
    () => {
      db.prepare(`
        INSERT INTO rag_knowledge (category, title, content, isSystemDefault, seedKey)
        VALUES ('CHOREOGRAPHY', 'Spoofed Both 3', 'Content', 1, 'some_seed_key')
      `).run();
    },
    (err: any) => {
      assert.match(err.message, /Direct insertion of canonical system defaults or seed keys is prohibited/);
      return true;
    }
  );

  // 13. Direct SQL INSERT with canonical-looking key is rejected by trigger
  assert.throws(
    () => {
      db.prepare(`
        INSERT INTO rag_knowledge (category, title, content, isSystemDefault, seedKey)
        VALUES ('CHOREOGRAPHY', 'Spoofed Canonical Key', 'Content', 0, 'canonical_v1_flamenco_zapateado')
      `).run();
    },
    (err: any) => {
      assert.match(err.message, /Direct insertion of canonical system defaults or seed keys is prohibited/);
      return true;
    }
  );

  // 14. Direct SQL INSERT with fabricated custom key is rejected by trigger
  assert.throws(
    () => {
      db.prepare(`
        INSERT INTO rag_knowledge (category, title, content, isSystemDefault, seedKey)
        VALUES ('CHOREOGRAPHY', 'Fabricated Custom Key', 'Content', 0, 'custom_hack_key')
      `).run();
    },
    (err: any) => {
      assert.match(err.message, /Direct insertion of canonical system defaults or seed keys is prohibited/);
      return true;
    }
  );

  // 15. Verify all four triggers are installed in sqlite_master
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as { name: string }[];
  const triggerNames = triggers.map((t) => t.name);
  assert.ok(triggerNames.includes('trg_rag_protect_canonical_update'), 'trg_rag_protect_canonical_update must exist');
  assert.ok(triggerNames.includes('trg_rag_prevent_user_promotion_update'), 'trg_rag_prevent_user_promotion_update must exist');
  assert.ok(triggerNames.includes('trg_rag_protect_canonical_delete'), 'trg_rag_protect_canonical_delete must exist');
  assert.ok(triggerNames.includes('trg_rag_prevent_canonical_insert'), 'trg_rag_prevent_canonical_insert must exist');

  db.close();
});

// =========================================================================
// Workstream C: Migration Compatibility Matrix (Cases A through J)
// =========================================================================

test('Workstream C - Migration Compatibility Matrix: Case A (Fresh Database)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `case_a_fresh_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {} });

  const db = openDb(testDbFile);
  const migs = db.prepare('SELECT name FROM _migrations ORDER BY name').all() as { name: string }[];
  assert.ok(migs.some((m) => m.name === '009_rag_provenance_reconciliation.sql'));
  assert.ok(migs.some((m) => m.name === '010_rag_default_insert_protection.sql'));

  const canonicalDefaults = db.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(canonicalDefaults.length, 12);
  assert.ok(canonicalDefaults.every((d) => d.ownerId === null && d.isQuarantined === 0 && d.seedKey?.startsWith('canonical_v1_')));

  const integrity = db.pragma('integrity_check') as any[];
  assert.equal(integrity[0].integrity_check, 'ok');
  db.close();
});

test('Workstream C - Migration Compatibility Matrix: Case B (Original 007 recorded, 008 absent)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `case_b_orig007_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {} });

  // DB has 001-006 + original 007
  const db = new Database(testDbFile);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '007') continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }
  // Simulate original 007
  db.exec(`
    ALTER TABLE rag_knowledge ADD COLUMN ownerId INTEGER REFERENCES users(id);
    ALTER TABLE rag_knowledge ADD COLUMN isSystemDefault INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE rag_knowledge ADD COLUMN isQuarantined INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX idx_rag_owner ON rag_knowledge(ownerId);
    CREATE INDEX idx_rag_system_default ON rag_knowledge(isSystemDefault);
    CREATE INDEX idx_rag_quarantine ON rag_knowledge(isQuarantined);
    CREATE INDEX idx_rag_tenant_lookup ON rag_knowledge(ownerId, isSystemDefault, isQuarantined);
    INSERT INTO _migrations VALUES('007_rag_tenant_isolation.sql');
  `);
  // Insert legacy unowned row
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
    VALUES (1, 'CHOREOGRAPHY', 'Legacy Dance', 'Legacy choreo', '[]', '{}', NULL, 0, 0)
  `).run();
  db.close();

  // Run openDb - applies 008 then 009
  const upgradedDb = openDb(testDbFile);
  const row1 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 1').get() as any;
  assert.equal(row1.isQuarantined, 1);
  assert.equal(row1.isSystemDefault, 0);

  const defaults = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(defaults.length, 12);
  upgradedDb.close();
});

test('Workstream C - Migration Compatibility Matrix: Case C & F (Original 007 AND Original 008 Recorded, Content-Matched SeedKey Cleared)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `case_c_f_historical_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {} });

  // Construct historical database with original 007 and original 008 recorded in _migrations
  const db = new Database(testDbFile);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '007') continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }

  // Schema state after original 007 & 008
  db.exec(`
    ALTER TABLE rag_knowledge ADD COLUMN ownerId INTEGER REFERENCES users(id);
    ALTER TABLE rag_knowledge ADD COLUMN isSystemDefault INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE rag_knowledge ADD COLUMN isQuarantined INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE rag_knowledge ADD COLUMN seedKey TEXT;
    CREATE INDEX idx_rag_owner ON rag_knowledge(ownerId);
    CREATE INDEX idx_rag_system_default ON rag_knowledge(isSystemDefault);
    CREATE INDEX idx_rag_quarantine ON rag_knowledge(isQuarantined);
    CREATE INDEX idx_rag_tenant_lookup ON rag_knowledge(ownerId, isSystemDefault, isQuarantined);
    CREATE UNIQUE INDEX idx_rag_seed_key ON rag_knowledge(seedKey) WHERE seedKey IS NOT NULL;
    INSERT INTO _migrations VALUES('007_rag_tenant_isolation.sql');
    INSERT INTO _migrations VALUES('008_rag_provenance_hardening.sql');
  `);

  // Create Users 301 and 302
  db.prepare('INSERT INTO users(id, email, passwordHash) VALUES(301, ?, ?)').run('user301@example.com', 'h1');
  db.prepare('INSERT INTO users(id, email, passwordHash) VALUES(302, ?, ?)').run('user302@example.com', 'h2');

  // Row 1 (Case F): Legacy private record that was assigned canonical seedKey via content matching in old 008!
  // Unowned, promoted to system default, unquarantined
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined, seedKey)
    VALUES (101, 'CHOREOGRAPHY', 'Flamenco Zapateado (Syncopated Footwork)', 'Private legacy user footwork routine', '["flamenco"]', '{}', NULL, 1, 0, 'canonical_v1_flamenco_zapateado')
  `).run();

  // Row 2: Legacy private record assigned another canonical seedKey
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined, seedKey)
    VALUES (102, 'CHOREOGRAPHY', 'Alapadma Mudra (Blooming Lotus)', 'Private legacy user lotus routine', '["lotus"]', '{}', NULL, 1, 0, 'canonical_v1_alapadma_mudra')
  `).run();

  // Row 3: User 301 private record (clean)
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined, seedKey)
    VALUES (103, 'VIRAL_HOOKS', 'User 301 Secret Hook', 'User 301 secret hook content', '["hook"]', '{}', 301, 0, 0, NULL)
  `).run();

  // Row 4: User 302 private record that old 008 had content-matched to mayura
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined, seedKey)
    VALUES (104, 'CHOREOGRAPHY', 'Mayura Mudra (Peacock Grace)', 'User 302 private peacock', '["mayura"]', '{}', 302, 1, 0, 'canonical_v1_mayura_mudra')
  `).run();

  db.close();

  // Run the REAL production migration runner openDb()
  const upgradedDb = openDb(testDbFile);

  // Verify 009 executed
  const mig009 = upgradedDb.prepare("SELECT 1 FROM _migrations WHERE name = '009_rag_provenance_reconciliation.sql'").get();
  assert.ok(mig009, '009 must execute on databases with 007 and 008 recorded');

  // Verify Row 101: Preserved, but seedKey cleared, de-promoted, quarantined
  const r101 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 101').get() as any;
  assert.equal(r101.seedKey, null, 'Untrusted historical seedKey must be cleared');
  assert.equal(r101.isSystemDefault, 0, 'Legacy record must be de-promoted from system default');
  assert.equal(r101.isQuarantined, 1, 'Legacy unowned record must be quarantined');
  assert.equal(r101.content, 'Private legacy user footwork routine', 'Content preserved');

  // Verify Row 102: Preserved, seedKey cleared, de-promoted, quarantined
  const r102 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 102').get() as any;
  assert.equal(r102.seedKey, null);
  assert.equal(r102.isSystemDefault, 0);
  assert.equal(r102.isQuarantined, 1);

  // Verify Row 103: User 301 private record retained cleanly
  const r103 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 103').get() as any;
  assert.equal(r103.ownerId, 301, 'User 301 ownership preserved');
  assert.equal(r103.isSystemDefault, 0);
  assert.equal(r103.isQuarantined, 0, 'Clean private record remains active');
  assert.equal(r103.seedKey, null);

  // Verify Row 104: User 302 ownership preserved, but seedKey stripped and quarantined
  const r104 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 104').get() as any;
  assert.equal(r104.ownerId, 302, 'User 302 ownership preserved');
  assert.equal(r104.seedKey, null, 'Untrusted seedKey stripped');
  assert.equal(r104.isSystemDefault, 0, 'De-promoted from system default');
  assert.equal(r104.isQuarantined, 1, 'Untrusted provenance quarantined');

  // Verify 12 fresh canonical defaults exist with unique seedKeys
  const canonicalDefaults = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(canonicalDefaults.length, 12, 'Must have exactly 12 canonical defaults');
  assert.ok(canonicalDefaults.every((d) => d.ownerId === null && d.isQuarantined === 0 && d.seedKey?.startsWith('canonical_v1_')));

  // Authentic Flamenco Zapateado is distinct from legacy row 101
  const authFlamenco = upgradedDb.prepare("SELECT * FROM rag_knowledge WHERE seedKey = 'canonical_v1_flamenco_zapateado'").get() as any;
  assert.ok(authFlamenco);
  assert.notEqual(authFlamenco.id, 101, 'Canonical default must be distinct from legacy row 101');
  assert.equal(authFlamenco.isSystemDefault, 1);

  // Multi-tenant search isolation test
  const rag = new RAGEngine(upgradedDb);

  // Foreign Tenant (User 999) searches for flamenco
  const foreignSearch = rag.search('footwork routine flamenco', { userId: 999 });
  // Must NOT see Row 101 or Row 102
  assert.ok(!foreignSearch.some((r) => r.item.id === 101), 'User 999 must NOT see legacy Row 101');
  assert.ok(!foreignSearch.some((r) => r.item.id === 102), 'User 999 must NOT see legacy Row 102');
  assert.ok(!foreignSearch.some((r) => r.item.id === 104), 'User 999 must NOT see User 302 Row 104');
  // MUST see authentic canonical default
  assert.ok(foreignSearch.some((r) => r.item.id === authFlamenco.id), 'User 999 sees authentic canonical default');

  // User 301 sees their own private row 103 and canonical defaults
  const u301Search = rag.search('secret hook', { userId: 301 });
  assert.ok(u301Search.some((r) => r.item.id === 103), 'User 301 sees their private record');

  upgradedDb.close();
});

test('Workstream C - Migration Compatibility Matrix: Case D & E (Corrected 007/008 Reconciled)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `case_d_e_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {} });

  // DB that ran up to 008
  const db = new Database(testDbFile);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '009') continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }
  db.close();

  // Run openDb - applies 009
  const upgradedDb = openDb(testDbFile);
  const mig009 = upgradedDb.prepare("SELECT 1 FROM _migrations WHERE name = '009_rag_provenance_reconciliation.sql'").get();
  assert.ok(mig009);

  const defaults = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(defaults.length, 12);
  upgradedDb.close();
});

test('Workstream C - Migration Compatibility Matrix: Case G (Multiple Ambiguous Legacy SeedKeys)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `case_g_ambiguous_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {} });

  const db = new Database(testDbFile);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '007') continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }

  // Schema state
  db.exec(`
    ALTER TABLE rag_knowledge ADD COLUMN ownerId INTEGER REFERENCES users(id);
    ALTER TABLE rag_knowledge ADD COLUMN isSystemDefault INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE rag_knowledge ADD COLUMN isQuarantined INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE rag_knowledge ADD COLUMN seedKey TEXT;
    INSERT INTO _migrations VALUES('007_rag_tenant_isolation.sql');
    INSERT INTO _migrations VALUES('008_rag_provenance_hardening.sql');
  `);

  // Multiple legacy records with canonical-looking seed keys (before unique partial index, or with different keys)
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined, seedKey)
    VALUES (201, 'CHOREOGRAPHY', 'Spin A', 'Spin A content', '[]', '{}', NULL, 1, 0, 'canonical_v1_kathak_chakkars')
  `).run();
  db.prepare(`
    INSERT INTO rag_knowledge (id, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined, seedKey)
    VALUES (202, 'CHOREOGRAPHY', 'Spin B', 'Spin B content', '[]', '{}', NULL, 1, 0, 'canonical_v1_kathak_chakkars_variant')
  `).run();
  db.close();

  // Run openDb - applies 009 cleanly
  const upgradedDb = openDb(testDbFile);
  const r201 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 201').get() as any;
  const r202 = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE id = 202').get() as any;
  assert.equal(r201.seedKey, null);
  assert.equal(r201.isQuarantined, 1);
  assert.equal(r202.seedKey, null);
  assert.equal(r202.isQuarantined, 1);

  const defaults = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(defaults.length, 12);
  upgradedDb.close();
});

test('Workstream C - Migration Compatibility Matrix: Case H (Existing Canonical Defaults Reconciled Safely)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `case_h_existing_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {} });

  // Run up to 008 with canonical defaults
  const db = new Database(testDbFile);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '009') continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }
  const countBefore009 = (db.prepare('SELECT COUNT(*) c FROM rag_knowledge').get() as { c: number }).c;
  assert.equal(countBefore009, 12);
  db.close();

  // Apply 009 via openDb
  const upgradedDb = openDb(testDbFile);
  const defaults = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(defaults.length, 12, 'Must still have exactly 12 verified defaults');
  assert.ok(defaults.every((d) => d.seedKey?.startsWith('canonical_v1_')));
  upgradedDb.close();
});

test('Workstream C - Migration Compatibility Matrix: Case I (Migration Invariant Failure & Atomic Rollback)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  const tempFixtureDir = path.join(scratchDir, `case_i_fixture_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tempFixtureDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `case_i_fail_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);

  t.after(() => {
    try { fs.rmSync(tempFixtureDir, { recursive: true, force: true }); } catch {}
    try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {}
  });

  // Create base migration 001
  fs.writeFileSync(path.join(tempFixtureDir, '001_base.sql'), `
    CREATE TABLE rag_knowledge (
      id INTEGER PRIMARY KEY,
      seedKey TEXT,
      isSystemDefault INTEGER DEFAULT 0,
      isQuarantined INTEGER DEFAULT 0,
      ownerId INTEGER
    );
  `);

  // Create failing migration 002 that violates an invariant check
  fs.writeFileSync(path.join(tempFixtureDir, '002_invariant_fail.sql'), `
    INSERT INTO rag_knowledge (seedKey, isSystemDefault) VALUES ('canonical_v1_test', 1);
    CREATE TEMP TABLE _chk (ok INTEGER NOT NULL CHECK (ok = 1));
    -- Invariant expects 12 defaults, but only 1 exists
    INSERT INTO _chk (ok)
    SELECT CASE WHEN (SELECT COUNT(*) FROM rag_knowledge WHERE isSystemDefault = 1) = 12 THEN 1 ELSE 0 END;
    DROP TABLE _chk;
  `);

  assert.throws(
    () => { openDb(testDbFile, tempFixtureDir); },
    (err: any) => {
      assert.match(err.message, /CHECK constraint failed/);
      return true;
    }
  );

  const inspectDb = new Database(testDbFile);
  const mig002 = inspectDb.prepare("SELECT 1 FROM _migrations WHERE name = '002_invariant_fail.sql'").get();
  assert.equal(mig002, undefined, 'Failing migration must NOT be recorded in _migrations');
  const rows = (inspectDb.prepare('SELECT COUNT(*) c FROM rag_knowledge').get() as { c: number }).c;
  assert.equal(rows, 0, 'Uncommitted rows must be rolled back');
  inspectDb.close();
});

test('Workstream C - Migration Compatibility Matrix: Case J (Migration 009 Already Recorded Idempotency)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `case_j_idempotent_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {} });

  const db1 = openDb(testDbFile);
  const count1 = (db1.prepare('SELECT COUNT(*) c FROM rag_knowledge').get() as { c: number }).c;
  db1.close();

  // Re-run openDb() on the same file
  const db2 = openDb(testDbFile);
  const count2 = (db2.prepare('SELECT COUNT(*) c FROM rag_knowledge').get() as { c: number }).c;
  assert.equal(count1, count2, 'Re-opening already migrated DB must not alter record count');

  const defaults = db2.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(defaults.length, 12);
  db2.close();
});

test('Workstream D - Migration Compatibility: Upgrade from 009 to 010 (Post-009 Database Compatibility)', (t) => {
  const scratchDir = path.join(import.meta.dirname, '../../data/scratch');
  fs.mkdirSync(scratchDir, { recursive: true });
  const testDbFile = path.join(scratchDir, `post009_to_010_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  t.after(() => { try { if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile); } catch {} });

  // 1. Construct a database where migrations 001 through 009 are already recorded
  const db = new Database(testDbFile);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');
  const migrationsDir = path.join(import.meta.dirname, '../migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (f >= '010') continue;
    db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
  }

  // Pre-conditions before 010:
  // Exactly 12 canonical defaults exist from 009
  const countBefore010 = (db.prepare('SELECT COUNT(*) c FROM rag_knowledge WHERE isSystemDefault = 1').get() as { c: number }).c;
  assert.equal(countBefore010, 12);

  // Before 010, trg_rag_prevent_canonical_insert does NOT exist yet
  const trigBefore = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_rag_prevent_canonical_insert'").get();
  assert.equal(trigBefore, undefined);

  db.close();

  // 2. Run production openDb() runner to apply 010
  const upgradedDb = openDb(testDbFile);

  // Migration 010 is now recorded in _migrations
  const mig010 = upgradedDb.prepare("SELECT 1 FROM _migrations WHERE name = '010_rag_default_insert_protection.sql'").get();
  assert.ok(mig010, '010 must execute on databases where 009 is already recorded');

  // Trigger is now installed
  const trigAfter = upgradedDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_rag_prevent_canonical_insert'").get();
  assert.ok(trigAfter, 'trg_rag_prevent_canonical_insert must exist after 010');

  // 12 canonical defaults remain intact
  const defaults = upgradedDb.prepare('SELECT * FROM rag_knowledge WHERE isSystemDefault = 1').all() as any[];
  assert.equal(defaults.length, 12);
  assert.ok(defaults.every((d) => d.seedKey?.startsWith('canonical_v1_')));

  // Direct SQL INSERT of system default is now rejected by the new trigger
  assert.throws(
    () => {
      upgradedDb.prepare(`
        INSERT INTO rag_knowledge (category, title, content, isSystemDefault, seedKey)
        VALUES ('CHOREOGRAPHY', 'Bypassed Default', 'Content', 1, NULL)
      `).run();
    },
    (err: any) => {
      assert.match(err.message, /Direct insertion of canonical system defaults or seed keys is prohibited/);
      return true;
    }
  );

  // Re-running openDb is idempotent
  upgradedDb.close();
  const dbReopened = openDb(testDbFile);
  const migs = dbReopened.prepare('SELECT name FROM _migrations WHERE name = ?').all('010_rag_default_insert_protection.sql');
  assert.equal(migs.length, 1, 'Migration 010 must not be recorded multiple times');
  dbReopened.close();
});

