import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import {
  CharacterGeneratorProvider,
  extractIdentityTokens,
  injectSceneIdentity,
} from '../providers/character_gen.js';

function client(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
}

test('Character Generator Provider - Unit Token Extraction & Scene Injection', () => {
  // Test token extraction
  const tokens = extractIdentityTokens(
    'striking classical dancer with deep radiant almond hazel eyes, sharp cheekbones',
    'wearing a midnight sapphire silk anarkali with ornate gold zardozi embroidery'
  );

  assert.ok(tokens.length >= 2);
  assert.ok(tokens.some((t) => t.toLowerCase().includes('hazel') || t.toLowerCase().includes('eyes')));
  assert.ok(tokens.some((t) => t.toLowerCase().includes('sapphire') || t.toLowerCase().includes('silk') || t.toLowerCase().includes('embroidery')));

  // Test scene injection to guarantee face & identity consistency across scenes
  const baseScenePrompt = 'performing a swift pirouette under dramatic spotlight';
  const injected = injectSceneIdentity(baseScenePrompt, tokens, 'Aria');

  assert.ok(injected.includes('Aria'));
  assert.ok(injected.includes('performing a swift pirouette'));
  assert.ok(injected.includes('ultra-detailed portrait'));
});

test('Character Entity Database Persistence & Identity Tokens', async () => {
  const db = openDb(':memory:');
  const provider = new CharacterGeneratorProvider(db);

  // Setup user and brand
  db.prepare("INSERT INTO users(id, email, passwordHash) VALUES(1, 'director@auravo.studio', 'hash')").run();
  db.prepare("INSERT INTO brands(id, ownerId, name, handle) VALUES(1, 1, 'Auravo Dance', 'auravo')").run();

  // Generate character entity
  const char = await provider.generateAndPersistCharacter({
    ownerId: 1,
    brandId: 1,
    name: 'Kavya Sen',
    appearance: 'Striking classical dancer with deep espresso eyes and sharp defined jawline',
    clothingStyle: 'Copper gold temple silk with traditional ornaments',
    personality: 'Graceful and intense soloist',
  });

  assert.ok(char.id);
  assert.equal(char.name, 'Kavya Sen');
  assert.ok(char.referenceImage.length > 0);
  assert.ok(char.identityTokens.length > 0);
  assert.equal(char.generationModel, 'AURAVO_LOCAL_HIGHRES_ENGINE');
  assert.ok(char.generationParameters.seed > 0);

  // Verify DB retrieval
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(char.id) as any;
  assert.ok(row);
  assert.equal(row.name, 'Kavya Sen');
  assert.equal(row.referenceImage, char.referenceImage);
  const parsedTokens = JSON.parse(row.identityTokens);
  assert.deepEqual(parsedTokens, char.identityTokens);
});

test('Character Entity API - Generation and Identity Retrieval Endpoints', async () => {
  const srv = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const c = client(base);

    // 1. Register & Setup Brand
    await c('POST', '/api/auth/register', { email: 'director@auravo.studio', password: 'password123' });
    const b = await c('POST', '/api/brands', {
      name: 'Auravo Studio',
      handle: 'auravo.test',
      niche: 'Classical Dance',
    });
    const brandId = b.body.id;

    // 2. Generate a custom character entity via API
    const genRes = await c('POST', '/api/characters/generate-entity', {
      brandId,
      name: 'Zara Thorne',
      appearance: 'Fiery dancer with dark curls and fierce brown eyes',
      clothingStyle: 'Crimson silk layered flamenco skirt and bodice',
      personality: 'Passionate and rhythmic',
    });

    assert.equal(genRes.status, 201);
    assert.equal(genRes.body.ok, true);
    assert.ok(genRes.body.character.id);
    assert.equal(genRes.body.character.name, 'Zara Thorne');
    assert.ok(genRes.body.character.referenceImage);
    assert.ok(genRes.body.character.identityTokens.length > 0);
    const charId = genRes.body.character.id;

    // 3. Fetch Character Identity specs
    const identRes = await c('GET', `/api/characters/${charId}/identity`);
    assert.equal(identRes.status, 200);
    assert.equal(identRes.body.id, charId);
    assert.equal(identRes.body.generationModel, 'AURAVO_LOCAL_HIGHRES_ENGINE');
    assert.ok(identRes.body.identityTokens.length > 0);

    // 4. Test archetype adoption persists identity tokens
    const adoptRes = await c('POST', '/api/characters/archetypes/adopt', {
      brandId,
      archetypeId: 'priya_desi',
    });
    assert.equal(adoptRes.status, 201);
    assert.equal(adoptRes.body.ok, true);
    assert.ok(adoptRes.body.character.referenceImage);
    assert.ok(adoptRes.body.character.identityTokens);
    const adoptedTokens = JSON.parse(adoptRes.body.character.identityTokens);
    assert.ok(adoptedTokens.length > 0);
  } finally {
    srv.close();
  }
});
