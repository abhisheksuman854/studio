import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  return async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
}

test('Sprint 1 - Complete End-to-End Character Studio Workflow', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const user1 = client(base);
    const user2 = client(base);

    // Step 0: Setup User 1 and User 1 Brand
    await user1('POST', '/api/auth/register', { email: 'creator@auravo.studio', password: 'Password123!' });
    const brandRes = await user1('POST', '/api/brands', {
      name: 'Auravo Cyberpunk Chronicles',
      handle: 'cyberpunk.chronicles',
      niche: 'Sci-Fi Fantasy',
    });
    assert.equal(brandRes.status, 201);
    const brandId = brandRes.body.id;

    // Workflow Step 1 & 2 & 3: Natural Language Description + Option Selection -> Preview Generation
    await t.test('1. Natural language character description and preview generation', async () => {
      const previewRes = await user1('POST', '/api/characters/preview-portrait', {
        name: 'Nyx Shadowblade',
        role: 'Rogue Infiltrator',
        region: 'Neo-Tokyo Underworld',
        appearance: 'Cybernetic luminous violet ocular implant, sculpted angular jaw, asymmetrical jet-black undercut hair',
        clothingStyle: 'Matte carbon-fiber stealth jacket with luminescent neon-teal fiber-optic seams',
        visualPrompt: 'Cinematic front-facing portrait of Nyx Shadowblade, rainy cyberpunk alley reflections, moody neon rim lighting, 8k resolution',
        negativePrompt: 'blurry, cartoon, 3d render, extra limbs, low resolution, bad anatomy',
        seed: 77701,
        testMock: true,
      });

      assert.equal(previewRes.status, 200);
      assert.equal(previewRes.body.ok, true);
      assert.ok(previewRes.body.portraitUrl);
      assert.ok(previewRes.body.portraitUrl.includes('.png'));
      assert.equal(previewRes.body.seed, 77701);
      assert.ok(previewRes.body.identityTokens.length >= 2);
      assert.ok(previewRes.body.identityTokens.some((tok: string) => tok.includes('cybernetic') || tok.includes('implant') || tok.includes('ocular') || tok.includes('undercut')));
      assert.equal(previewRes.body.dimensions[0], 1024);
      assert.equal(previewRes.body.dimensions[1], 1024);
      assert.ok(previewRes.body.fileSize > 1000);
      assert.ok(previewRes.body.model.includes('SDXL_LIGHTNING'));
      assert.ok(previewRes.body.pixelStats.valid_render);

      // Verify the preview image file physically exists on disk
      const filename = previewRes.body.portraitUrl.split('/').pop();
      const onDiskPath = path.resolve('./data/storage/images', filename);
      assert.ok(fs.existsSync(onDiskPath), `Preview image file must exist on disk: ${onDiskPath}`);
      assert.ok(fs.statSync(onDiskPath).size > 1000);
    });

    // Workflow Step 4 & 5 & 6 & 7: Submit Generation Request & Persist Character
    let createdCharacterId = 0;
    let savedReferenceImageUrl = '';

    await t.test('2. Generate and persist character entity with locked identity tokens', async () => {
      const genRes = await user1('POST', '/api/characters/generate-entity', {
        brandId,
        name: 'Nyx Shadowblade',
        role: 'Rogue Infiltrator',
        region: 'Neo-Tokyo Underworld',
        age: 26,
        appearance: 'Cybernetic luminous violet ocular implant, sculpted angular jaw, asymmetrical jet-black undercut hair',
        clothingStyle: 'Matte carbon-fiber stealth jacket with luminescent neon-teal fiber-optic seams',
        personality: 'Calculating, stealthy, fiercely loyal to her crew',
        voiceStyle: 'Karen',
        customPrompt: 'Cinematic front-facing portrait of Nyx Shadowblade, rainy cyberpunk alley reflections, moody neon rim lighting, 8k resolution',
        negativePrompt: 'blurry, cartoon, 3d render, extra limbs, low resolution',
        seed: 77701,
        testMock: true,
      });

      assert.equal(genRes.status, 201);
      assert.equal(genRes.body.ok, true);
      assert.ok(genRes.body.character.id);
      createdCharacterId = genRes.body.character.id;
      savedReferenceImageUrl = genRes.body.character.referenceImage;

      assert.equal(genRes.body.character.name, 'Nyx Shadowblade');
      assert.equal(genRes.body.character.age, 26);
      assert.ok(genRes.body.character.referenceImage.length > 0);
      assert.ok(genRes.body.character.generationModel.includes('SDXL_LIGHTNING'));
      assert.ok(genRes.body.character.identityTokens.length >= 2);

      // Verify image exists on disk
      const filename = savedReferenceImageUrl.split('/').pop()!;
      const onDiskPath = path.resolve('./data/storage/images', filename);
      assert.ok(fs.existsSync(onDiskPath), `Character portrait image must exist on disk: ${onDiskPath}`);
    });

    // Workflow Step 8 & 9: Inspect & Reopen Character from Character Library
    await t.test('3. Reopen and inspect character from library via GET /api/characters/:id', async () => {
      // Fetch single character by ID
      const singleRes = await user1('GET', `/api/characters/${createdCharacterId}`);
      assert.equal(singleRes.status, 200);
      assert.equal(singleRes.body.id, createdCharacterId);
      assert.equal(singleRes.body.name, 'Nyx Shadowblade');
      assert.equal(singleRes.body.brandId, brandId);
      assert.equal(singleRes.body.referenceImage, savedReferenceImageUrl);
      assert.ok(singleRes.body.identityTokens.length >= 2);
      assert.ok(singleRes.body.generationParameters);

      // Fetch identity data via content engine endpoint
      const identRes = await user1('GET', `/api/characters/${createdCharacterId}/identity`);
      assert.equal(identRes.status, 200);
      assert.equal(identRes.body.id, createdCharacterId);
      assert.equal(identRes.body.name, 'Nyx Shadowblade');
      assert.deepEqual(identRes.body.identityTokens, singleRes.body.identityTokens);

      // Fetch all characters in brand library
      const listRes = await user1('GET', `/api/characters?brandId=${brandId}`);
      assert.equal(listRes.status, 200);
      assert.ok(Array.isArray(listRes.body));
      const found = listRes.body.find((c: any) => c.id === createdCharacterId);
      assert.ok(found, 'Created character must be present in brand library listing');
      assert.equal(found.name, 'Nyx Shadowblade');
    });

    // Workflow Step 10: Multi-Tenant Ownership Isolation Verification
    await t.test('4. Security & Tenant Isolation: User 2 cannot access or mutate User 1 character', async () => {
      // Create user 2 session directly in DB (since self-registration is closed after first user)
      const u2Token = '2222222222222222222222222222222222222222222222222222222222222222';
      const u2Hash = (await import('node:crypto')).createHash('sha256').update(u2Token).digest('hex');
      db.prepare("INSERT INTO users(id, email, passwordHash) VALUES(2, 'other@tenant.com', 'hash2')").run();
      db.prepare('INSERT INTO sessions VALUES(?, ?, ?)').run(u2Hash, 2, Date.now() + 3600000);

      const u2Client = async (method: string, p: string, body?: unknown) => {
        const r = await fetch(base + p, {
          method,
          headers: { 'content-type': 'application/json', cookie: `sid=${u2Token}` },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await r.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        return { status: r.status, body: json };
      };

      // User 2 lists characters -> must be empty
      const u2List = await u2Client('GET', '/api/characters');
      assert.equal(u2List.status, 200);
      assert.equal(u2List.body.length, 0);

      // User 2 attempts to fetch User 1's character by ID -> 404
      const u2Get = await u2Client('GET', `/api/characters/${createdCharacterId}`);
      assert.equal(u2Get.status, 404);

      // User 2 attempts to fetch User 1's character identity -> 404
      const u2Ident = await u2Client('GET', `/api/characters/${createdCharacterId}/identity`);
      assert.equal(u2Ident.status, 404);

      // User 2 attempts to modify User 1's character -> 404
      const u2Patch = await u2Client('PATCH', `/api/characters/${createdCharacterId}`, { name: 'Hacked Nyx' });
      assert.equal(u2Patch.status, 404);

      // User 2 attempts to delete User 1's character -> 404
      const u2Delete = await u2Client('DELETE', `/api/characters/${createdCharacterId}`);
      assert.equal(u2Delete.status, 404);
    });

    // Workflow Step 11: Character Editing & Updating in Library
    await t.test('5. Character library patch update', async () => {
      const updateRes = await user1('PATCH', `/api/characters/${createdCharacterId}`, {
        personality: 'Master strategist and elite cyber-operative',
      });
      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.personality, 'Master strategist and elite cyber-operative');

      const verifyGet = await user1('GET', `/api/characters/${createdCharacterId}`);
      assert.equal(verifyGet.body.personality, 'Master strategist and elite cyber-operative');
    });

    // Workflow Step 12: Scene Prompt Identity Injection
    await t.test('6. Scene prompt identity injection consistency', () => {
      const provider = new CharacterGeneratorProvider(db);
      const char = provider.getCharacterById(createdCharacterId, 1);
      assert.ok(char);

      const scenePrompt = 'hacking into the megacorporation data vault under high security alert';
      const enriched = provider.injectSceneIdentity(scenePrompt, char);

      assert.ok(enriched.visualPrompt.includes('Nyx Shadowblade'));
      assert.ok(enriched.visualPrompt.includes('hacking into the megacorporation data vault'));
      assert.ok(enriched.negativePrompt.length > 0);
    });

    // Workflow Step 13: Character Deletion from Library
    await t.test('7. Character library deletion', async () => {
      const deleteRes = await user1('DELETE', `/api/characters/${createdCharacterId}`);
      assert.equal(deleteRes.status, 204);

      const checkGet = await user1('GET', `/api/characters/${createdCharacterId}`);
      assert.equal(checkGet.status, 404);
    });
  } finally {
    srv.close();
  }
});
