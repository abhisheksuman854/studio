import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { RAGEngine } from '../providers/rag_engine.js';
import { LocalLLMProvider } from '../providers/llm.js';

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

test('RAG Engine - Seeding, Token Search & Knowledge Enrichment', () => {
  const db = openDb(':memory:');
  const rag = new RAGEngine(db);

  // 1. Verify default knowledge items seeded as verified system defaults with unique seedKey
  const allItems = rag.listKnowledge();
  assert.ok(allItems.length >= 8, `Expected at least 8 seeded knowledge items, got ${allItems.length}`);
  assert.ok(allItems.every((i) => i.isSystemDefault === true && !i.isQuarantined && typeof i.seedKey === 'string' && i.seedKey.startsWith('canonical_v1_')));

  // 2. Search for choreography mudra
  const lotusResults = rag.search('lotus blooming gesture');
  assert.ok(lotusResults.length > 0);
  assert.ok(lotusResults[0].item.title.includes('Alapadma'));
  assert.equal(lotusResults[0].item.category, 'CHOREOGRAPHY');

  // 3. Search for Kathak spins
  const spinResults = rag.search('kathak fast pirouette chakkar');
  assert.ok(spinResults.length > 0);
  assert.ok(spinResults[0].item.title.includes('Chakkar'));

  // 4. Search for viral hook patterns
  const hookResults = rag.search('unbroken eye contact camera gaze', { category: 'VIRAL_HOOKS' });
  assert.ok(hookResults.length > 0);
  assert.ok(hookResults[0].item.title.includes('Eye Contact'));

  // 5. Enrich prompt with RAG citations
  const { enrichedPrompt, citations } = rag.enrichPromptWithRAG('Aria Kathak monsoon dance with silk drape');
  assert.ok(citations.length > 0);
  assert.ok(enrichedPrompt.includes('[AUTHENTIC CHOREOGRAPHY & CONSISTENCY KNOWLEDGE BASE]'));

  // 6. Add custom user-owned knowledge item (with authenticated tenant scope)
  db.prepare('INSERT INTO users(id, email, passwordHash) VALUES(101, ?, ?)').run('user101@example.com', 'h101');
  const custom = rag.addKnowledge({
    category: 'CHOREOGRAPHY',
    title: 'Ghungroo Percussive Ankle Bells',
    content: 'Dancer strikes rhythmic bells tied around ankles in sync with the tabla bols.',
    tags: ['ghungroo', 'bells', 'kathak', 'ankle', 'tabla'],
    metadata: { difficulty: 'EXPERT' },
  }, 101);

  assert.ok(custom.id);
  assert.equal(custom.ownerId, 101);
  assert.equal(custom.isSystemDefault, false);
  const foundCustom = rag.search('ghungroo bells', { userId: 101 });
  assert.ok(foundCustom.some((f) => f.item.title.includes('Ghungroo')));
});

test('Local LLM Provider with RAG - Authentic Mudras & Viral Hooks in 5-Scene Story', async () => {
  const db = openDb(':memory:');
  const rag = new RAGEngine(db);
  const llm = new LocalLLMProvider(rag);

  const brand = {
    id: 1,
    name: 'Auravo Kathak Studio',
    handle: '@auravo.dance',
    niche: 'Kathak & Classical Indo-Fusion',
    tone: 'regal, mysterious, intense',
    visualStyle: 'Dramatic theater spotlight, swirling silk anarkali, 9:16 vertical',
    preferredTopics: ['Kathak chakkar pirouettes', 'Monsoon peacock gateway'],
    prohibitedTopics: ['nudity'],
  };

  const character = {
    name: 'Priya',
    appearance: 'Striking classical dancer with deep espresso eyes and sharp jawline',
    clothingStyle: 'Midnight sapphire silk anarkali with ornate gold zardozi',
    personality: 'Regal, intense and poised soloist',
  };

  const story = await llm.generateStory(brand, 'Monsoon Peacock Gateway with Alapadma and Chakkars', undefined, character);

  assert.ok(story.scenes.length === 5);
  // Scene 1 Hook: Should incorporate viral hook or authentic atmosphere
  assert.ok(story.scenes[0].narration.length > 10);
  // Scene 2: Should incorporate retrieved mudras into prompt
  assert.ok(
    story.scenes[1].visualPrompt.toLowerCase().includes('alapadma') ||
    story.scenes[1].visualPrompt.toLowerCase().includes('mudra') ||
    story.scenes[1].visualPrompt.toLowerCase().includes('hands')
  );
  // Scene 3: Should incorporate dynamic choreo / chakkars
  assert.ok(
    story.scenes[2].visualPrompt.toLowerCase().includes('chakkar') ||
    story.scenes[2].visualPrompt.toLowerCase().includes('dance')
  );
});

test('RAG Security & Multi-Tenant Isolation Suite', async (t) => {
  const db = openDb(':memory:');
  const app = createApp(db);
  const srv = app.listen(0);
  const port = (srv.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  t.after(() => {
    srv.close();
    db.close();
  });

  // 1. Unauthenticated requests to /api/rag/knowledge are rejected with 401
  await t.test('Unauthenticated knowledge listing is rejected with 401', async () => {
    const unauth = makeClient(base);
    const res = await unauth('GET', '/api/rag/knowledge');
    assert.equal(res.status, 401);
  });

  // 2. Unauthenticated requests to /api/rag/search are rejected with 401
  await t.test('Unauthenticated search is rejected with 401', async () => {
    const unauth = makeClient(base);
    const res = await unauth('GET', '/api/rag/search?q=lotus');
    assert.equal(res.status, 401);
  });

  // Setup User A via self-registration
  const clientA = makeClient(base);
  const regA = await clientA('POST', '/api/auth/register', { email: 'usera@example.com', password: 'password123' });
  assert.equal(regA.status, 201);
  const userAId = (regA.body as any).id;

  // Setup User B directly in database (due to single-owner self-registration policy)
  const userBToken = crypto.randomBytes(32).toString('hex');
  const userBId = db.prepare('INSERT INTO users(email, passwordHash) VALUES(?, ?)').run('userb@example.com', 'fakehash').lastInsertRowid as number;
  db.prepare('INSERT INTO sessions VALUES(?, ?, ?)').run(
    crypto.createHash('sha256').update(userBToken).digest('hex'),
    userBId,
    Date.now() + 7 * 864e5
  );
  const clientB = makeClient(base, `sid=${userBToken}`);

  let userAItemId: number;

  // 3. User A can create knowledge owned by User A
  await t.test('User A can create private knowledge record', async () => {
    const res = await clientA('POST', '/api/rag/knowledge', {
      category: 'CHOREOGRAPHY',
      title: 'User A Secret Pirouette Technique',
      content: 'A proprietary spinning technique known exclusively to User A with SecretSpinCode99.',
      tags: ['usera', 'secret', 'spin', 'proprietary'],
      metadata: { privateLevel: 'TOP_SECRET' },
    });
    assert.equal(res.status, 201);
    assert.equal((res.body as any).ok, true);
    const item = (res.body as any).item;
    assert.ok(item.id);
    assert.equal(item.ownerId, userAId);
    assert.equal(item.isSystemDefault, false);
    userAItemId = item.id;
  });

  // 4. User B cannot list User A's private knowledge
  await t.test('User B cannot list User A private knowledge', async () => {
    const resB = await clientB('GET', '/api/rag/knowledge');
    assert.equal(resB.status, 200);
    const items = resB.body as any[];
    assert.ok(!items.some((i) => i.id === userAItemId));
    assert.ok(!items.some((i) => i.title.includes('Secret Pirouette Technique')));

    // User A should see their own item
    const resA = await clientA('GET', '/api/rag/knowledge');
    assert.equal(resA.status, 200);
    assert.ok((resA.body as any[]).some((i) => i.id === userAItemId));
  });

  // 5. User B cannot retrieve User A's private knowledge through search
  await t.test('User B cannot search User A private knowledge', async () => {
    const searchB = await clientB('GET', '/api/rag/search?q=SecretSpinCode99');
    assert.equal(searchB.status, 200);
    assert.equal((searchB.body as any[]).length, 0);

    // User A search should find it
    const searchA = await clientA('GET', '/api/rag/search?q=SecretSpinCode99');
    assert.equal(searchA.status, 200);
    assert.equal((searchA.body as any[]).length, 1);
    assert.equal((searchA.body as any[])[0].item.id, userAItemId);
  });

  // 6. User B cannot update User A's knowledge
  await t.test('User B cannot update User A knowledge (fails with 404)', async () => {
    const updateRes = await clientB('PUT', `/api/rag/knowledge/${userAItemId}`, {
      title: 'Hacked by User B',
    });
    assert.equal(updateRes.status, 404);

    // Verify User A item remains unchanged
    const row = db.prepare('SELECT title FROM rag_knowledge WHERE id=?').get(userAItemId) as { title: string };
    assert.equal(row.title, 'User A Secret Pirouette Technique');
  });

  // 7. User B cannot delete User A's knowledge
  await t.test('User B cannot delete User A knowledge (fails with 404)', async () => {
    const delRes = await clientB('DELETE', `/api/rag/knowledge/${userAItemId}`);
    assert.equal(delRes.status, 404);

    // Verify User A item still exists
    const row = db.prepare('SELECT id FROM rag_knowledge WHERE id=?').get(userAItemId);
    assert.ok(row);
  });

  // 8. A user cannot spoof another user's ownerId
  await t.test('User cannot spoof ownerId on creation', async () => {
    const spoofRes = await clientA('POST', '/api/rag/knowledge', {
      category: 'VIRAL_HOOKS',
      title: 'Spoofed Owner Item',
      content: 'Attempting to assign ownership to User B.',
      ownerId: userBId,
    });
    assert.equal(spoofRes.status, 400);
    assert.ok((spoofRes.body as any).error.includes('forbidden'));
  });

  // 9. A user cannot create a system-default record
  await t.test('User cannot create system-default knowledge', async () => {
    const sysRes = await clientA('POST', '/api/rag/knowledge', {
      category: 'VIRAL_HOOKS',
      title: 'Fake System Default',
      content: 'Attempting to inject a global default.',
      isSystemDefault: true,
    });
    assert.equal(sysRes.status, 400);
    assert.ok((sysRes.body as any).error.includes('forbidden'));

    // User cannot inject seedKey
    const seedRes = await clientA('POST', '/api/rag/knowledge', {
      category: 'VIRAL_HOOKS',
      title: 'Fake Seed Key Item',
      content: 'Attempting to spoof canonical provenance.',
      seedKey: 'canonical_v1_fake_item',
    });
    assert.equal(seedRes.status, 400);
    assert.ok((seedRes.body as any).error.includes('forbidden'));
  });

  // 10. System default records are immutable and cannot be deleted
  await t.test('System default knowledge items are immutable and protected from deletion', async () => {
    const sysRow = db.prepare("SELECT id FROM rag_knowledge WHERE isSystemDefault=1 AND title LIKE '%Alapadma%'").get() as { id: number };
    assert.ok(sysRow);

    // Attempt modification
    const modRes = await clientA('PUT', `/api/rag/knowledge/${sysRow.id}`, {
      title: 'Corrupted System Default',
    });
    assert.equal(modRes.status, 403);
    assert.ok((modRes.body as any).error.includes('immutable'));

    // Attempt deletion
    const delRes = await clientA('DELETE', `/api/rag/knowledge/${sysRow.id}`);
    assert.equal(delRes.status, 403);
    assert.ok((delRes.body as any).error.includes('cannot be deleted'));

    // Verify record unchanged
    const verify = db.prepare('SELECT title FROM rag_knowledge WHERE id=?').get(sysRow.id) as { title: string };
    assert.ok(verify.title.includes('Alapadma'));
  });

  // 11. Verified system-default records are visible to all authorized tenants
  await t.test('Verified system-default records are visible across all authenticated users', async () => {
    const resA = await clientA('GET', '/api/rag/search?q=alapadma');
    assert.equal(resA.status, 200);
    assert.ok((resA.body as any[]).some((r: any) => r.item.isSystemDefault && r.item.title.includes('Alapadma')));

    const resB = await clientB('GET', '/api/rag/search?q=alapadma');
    assert.equal(resB.status, 200);
    assert.ok((resB.body as any[]).some((r: any) => r.item.isSystemDefault && r.item.title.includes('Alapadma')));
  });

  // 12. Unknown-provenance legacy records remain quarantined
  await t.test('Quarantined legacy records are not exposed to ordinary users', async () => {
    // Insert a quarantined unverified row directly into the database
    const qRow = db.prepare(`
      INSERT INTO rag_knowledge (category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
      VALUES ('CHOREOGRAPHY', 'Suspicious Unverified Legacy Choreography', 'Unverified provenance content QuarantineCode777', '[]', '{}', NULL, 0, 1)
    `).run();
    const qId = qRow.lastInsertRowid;

    // User A query should NOT see quarantined item
    const listRes = await clientA('GET', '/api/rag/knowledge');
    assert.ok(!(listRes.body as any[]).some((i) => i.id === qId));

    // User A search should NOT find quarantined item
    const searchRes = await clientA('GET', '/api/rag/search?q=QuarantineCode777');
    assert.equal((searchRes.body as any[]).length, 0);

    // Direct update attempt should fail with 404
    const updRes = await clientA('PUT', `/api/rag/knowledge/${qId}`, { title: 'Attempted Unquarantine' });
    assert.equal(updRes.status, 404);
  });

  // 13. Private RAG content cannot leak into another tenant's generated story prompt
  await t.test('Private RAG content never enters another tenant story generation', async () => {
    const rag = new RAGEngine(db);
    const llm = new LocalLLMProvider(rag);

    // User A has private item with SecretSpinCode99
    // User B generates a story on a dance topic
    const brandB = {
      id: 2,
      ownerId: userBId,
      name: 'User B Studio',
      preferredTopics: ['SecretSpinCode99 routine'],
      prohibitedTopics: [],
    };

    const storyB = await llm.generateStory(brandB, 'SecretSpinCode99 routine', undefined, undefined, userBId);
    // User B's generated scenes must NOT contain User A's private content
    const leakedIntoB = storyB.scenes.some(
      (s) => s.visualPrompt.includes('SecretSpinCode99') || s.narration.includes('SecretSpinCode99')
    );
    assert.equal(leakedIntoB, false, 'User A private knowledge leaked into User B story prompt!');

    // User A generates a story on the same topic -> User A's story SHOULD retrieve it
    const brandA = {
      id: 1,
      ownerId: userAId,
      name: 'User A Studio',
      preferredTopics: ['SecretSpinCode99 routine'],
      prohibitedTopics: [],
    };
    const storyA = await llm.generateStory(brandA, 'SecretSpinCode99 routine', undefined, undefined, userAId);
    const injectedIntoA = storyA.scenes.some(
      (s) => s.visualPrompt.includes('Secret Pirouette Technique') || s.visualPrompt.includes('SecretSpinCode99')
    );
    assert.equal(injectedIntoA, true, 'User A should have their own private knowledge injected into story prompt!');
  });

  // 14. User A can update and delete their own knowledge
  await t.test('User A can successfully update and delete their own knowledge item', async () => {
    // Update
    const upRes = await clientA('PUT', `/api/rag/knowledge/${userAItemId}`, {
      title: 'User A Updated Pirouette Title',
      content: 'Updated content for User A.',
    });
    assert.equal(upRes.status, 200);
    assert.equal((upRes.body as any).item.title, 'User A Updated Pirouette Title');

    // Delete
    const delRes = await clientA('DELETE', `/api/rag/knowledge/${userAItemId}`);
    assert.equal(delRes.status, 200);
    assert.equal((delRes.body as any).ok, true);

    // Verify deletion
    const listAgain = await clientA('GET', '/api/rag/knowledge');
    assert.ok(!(listAgain.body as any[]).some((i) => i.id === userAItemId));
  });
});
