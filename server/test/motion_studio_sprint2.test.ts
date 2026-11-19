import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import {
  validateMotionVideo,
  validateCharacterInputAsset,
  SUPPORTED_MOTION_PRESETS,
  getFfmpegPath,
} from '../providers/motion_gen.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
    return {
      status: r.status,
      headers: r.headers,
      body: r.status === 204 ? null : await r.json().catch(() => null),
    };
  };
}

test('Sprint 2.1 - Motion Studio: Character Input, Pixel Integrity & Genuine Wave Remediation Suite', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const user1 = client(base);
    const user2 = client(base);

    // Setup User 1 via registration
    await user1('POST', '/api/auth/register', { email: 'creator@auravo.studio', password: 'Password123!' });

    // Setup User 2 directly in DB
    const u2Token = '2222222222222222222222222222222222222222222222222222222222222222';
    const u2Hash = (await import('node:crypto')).createHash('sha256').update(u2Token).digest('hex');
    db.prepare("INSERT INTO users(id, email, passwordHash) VALUES(2, 'intruder@auravo.studio', 'hash2')").run();
    db.prepare('INSERT INTO sessions VALUES(?, ?, ?)').run(u2Hash, 2, Date.now() + 3600000);

    const user2Client = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(base + p, {
        method,
        headers: { 'content-type': 'application/json', cookie: `sid=${u2Token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const sc = r.headers.get('set-cookie');
      return {
        status: r.status,
        headers: r.headers,
        body: r.status === 204 ? null : await r.json().catch(() => null),
      };
    };

    // Setup Brand for User 1
    const brandRes = await user1('POST', '/api/brands', {
      name: 'Auravo Cyberpunk Chronicles',
      handle: 'cyberpunk.chronicles',
      niche: 'Sci-Fi Fantasy',
    });
    assert.equal(brandRes.status, 201);
    const brandId = brandRes.body.id;

    // Create Genuine Character for User 1 pointing to char_aria_dev_1794907355086.png
    const ariaImgRelPath = '/storage/images/char_aria_dev_1794907355086.png';
    const row = db.prepare(`
      INSERT INTO characters (
        ownerId, brandId, name, description, age, personality, appearance,
        clothingStyle, visualPrompt, negativePrompt, voiceStyle,
        referenceImage, generationModel, generationParameters, identityTokens, metadata, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      1,
      brandId,
      'Aria Dev',
      'Radiant stage soloist in midnight sapphire silk gown',
      23,
      'Mesmerizing stage presence',
      'Radiant dancer with almond hazel eyes, high cheekbones',
      'Midnight sapphire silk gown',
      'Photorealistic vertical portrait of Aria Dev',
      'blurry, distorted',
      'Samantha',
      ariaImgRelPath,
      'LOCAL_PORTRAIT_ILLUSTRATION',
      '{}',
      '["almond hazel eyes", "high cheekbones", "sapphire silk gown"]',
      '{}'
    );
    const char1Id = Number(row.lastInsertRowid);
    const char1 = db.prepare('SELECT * FROM characters WHERE id=?').get(char1Id) as any;

    // TEST-MS-01: Movement Presets Listing
    await t.test('1. List available movement presets (TEST-MS-01)', async () => {
      const res = await user1('GET', '/api/motion/presets');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 5);

      const presetIds = res.body.map((p: any) => p.id);
      assert.ok(presetIds.includes('wave'));
      assert.ok(presetIds.includes('head_turn'));
      assert.ok(presetIds.includes('walking'));
      assert.ok(presetIds.includes('simple_dance'));
      assert.ok(presetIds.includes('natural_gesture'));
    });

    // TEST-MS-02: Character Selection & Ownership Enforcement
    await t.test('2. Character selection & ownership verification (TEST-MS-02)', async () => {
      const missingRes = await user1('POST', '/api/motion/generate', {
        characterId: 99999,
        preset: 'Wave',
      });
      assert.equal(missingRes.status, 404);
      assert.ok(missingRes.body.error.includes('Character not found'));

      const crossRes = await user2Client('POST', '/api/motion/generate', {
        characterId: char1.id,
        preset: 'Wave',
      });
      assert.equal(crossRes.status, 404);
    });

    // TEST-MS-03: Unsupported Movement Preset Rejection
    await t.test('3. Unsupported preset rejection (TEST-MS-03)', async () => {
      const badPresetRes = await user1('POST', '/api/motion/generate', {
        characterId: char1.id,
        preset: 'ImpossibleBackflip360',
      });
      assert.equal(badPresetRes.status, 400);
      assert.ok(badPresetRes.body.error.includes('Unsupported movement preset'));
    });

    // TEST-MS-04: Static Frame Rejection Validator
    await t.test('4. Output validator rejects static repeating frames (TEST-MS-04)', async () => {
      const storageVideosDir = path.resolve('./data/storage/videos');
      fs.mkdirSync(storageVideosDir, { recursive: true });
      const staticVideoPath = path.join(storageVideosDir, `test_static_${Date.now()}.mp4`);

      const ffmpegBin = getFfmpegPath();
      await execFileAsync(ffmpegBin, [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=blue:s=320x240:d=2.0:r=30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        staticVideoPath,
      ]);

      const valResult = await validateMotionVideo(staticVideoPath, 0.8);
      assert.equal(valResult.isValid, false);
      assert.equal(valResult.isStaticOnly, true);
      assert.ok(valResult.error?.includes('STATIC_FRAME_REJECTED'));

      try { fs.unlinkSync(staticVideoPath); } catch (_) {}
    });

    // TEST-MS-05: Missing Character Image Rejection (Stage A)
    await t.test('5. Missing character image rejected with CHARACTER_ASSET_NOT_FOUND (TEST-MS-05)', async () => {
      const val = await validateCharacterInputAsset('./data/storage/images/non_existent_asset_xyz.png');
      assert.equal(val.isValid, false);
      assert.equal(val.errorCategory, 'CHARACTER_ASSET_NOT_FOUND');
    });

    // TEST-MS-06: Invalid / Corrupt Image Rejection (Stage A)
    await t.test('6. Corrupt or undersized image rejected with CHARACTER_ASSET_INVALID (TEST-MS-06)', async () => {
      const tempTiny = path.resolve('./data/storage/images/temp_tiny_test.png');
      fs.writeFileSync(tempTiny, Buffer.from('corrupt_bytes'));
      try {
        const val = await validateCharacterInputAsset(tempTiny);
        assert.equal(val.isValid, false);
        assert.ok(val.errorCategory === 'CHARACTER_ASSET_INVALID' || val.errorCategory === 'CHARACTER_ASSET_DECODE_FAILED');
      } finally {
        try { fs.unlinkSync(tempTiny); } catch (_) {}
      }
    });

    // TEST-MS-07: Placeholder Image Rejection (Stage A & E)
    await t.test('7. Placeholder card rejected with CHARACTER_ASSET_PLACEHOLDER (TEST-MS-07)', async () => {
      const legacyPath = path.resolve('./data/storage/images/char_aria_dev_placeholder_legacy.png');
      if (fs.existsSync(legacyPath)) {
        const val = await validateCharacterInputAsset(legacyPath);
        assert.equal(val.isValid, false);
        assert.equal(val.isPlaceholder, true);
        assert.equal(val.errorCategory, 'CHARACTER_ASSET_PLACEHOLDER');
      }
    });

    // TEST-MS-08: Genuine Character Input Asset Verification (Stage C)
    await t.test('8. Genuine character input asset passes validation (TEST-MS-08)', async () => {
      const realPath = path.resolve('./data/storage/images/char_aria_dev_1794907355086.png');
      const val = await validateCharacterInputAsset(realPath);
      assert.equal(val.isValid, true);
      assert.equal(val.isPlaceholder, false);
      assert.equal(val.width, 768);
      assert.equal(val.height, 1024);
      assert.ok(val.fileSize > 100000);
      assert.equal(val.sha256, '0379719c8f7f423ff2d7b671a46c7a1d8f45757b2f2ccf46ebd24d99aeffe7a9');
    });

    // TEST-MS-09: Genuine Wave Character Animation Generation (Stage D)
    let generatedVideoUrl = '';
    let generatedSha256 = '';
    let generatedFileSize = 0;
    let generatedDimensions = [0, 0];
    let generatedDuration = 0;

    await t.test('9. Genuine character animation generation with multi-frame wave movement (TEST-MS-09)', async () => {
      const genRes = await user1('POST', '/api/motion/generate', {
        characterId: char1.id,
        preset: 'Wave',
        durationSec: 2.0,
        fps: 30,
        description: 'Authentic 60-frame theatrical wave with arm articulation',
      });

      assert.equal(genRes.status, 200);
      assert.equal(genRes.body.ok, true);
      assert.equal(genRes.body.preset, 'Wave');
      assert.ok(genRes.body.videoUrl.startsWith('/api/media/videos/'));
      assert.ok(genRes.body.durationSec >= 1.0);
      assert.equal(genRes.body.fps, 30);
      assert.equal(genRes.body.frameCount, 60);
      assert.ok(genRes.body.fileSize > 50000);
      assert.ok(genRes.body.sha256.length >= 32);

      // Verify frame-difference metrics confirm genuine arm movement
      assert.ok(genRes.body.meanFrameDiff > 0.001, 'Mean frame difference must be non-zero for genuine character movement');
      assert.ok(genRes.body.maxFrameDiff > 0.10, 'Max frame difference must confirm articulated movement');
      assert.ok(genRes.body.armRegionDiff > 0.02, 'Arm region diff must confirm localized arm articulation');
      assert.ok(genRes.body.cornerRegionDiff < 0.01, 'Corner diff must confirm background stability');

      // Verify video file exists on disk
      const videoFilename = path.basename(genRes.body.videoUrl);
      const onDiskPath = path.resolve('./data/storage/videos', videoFilename);
      assert.ok(fs.existsSync(onDiskPath), `Video file must exist on disk: ${onDiskPath}`);
      assert.equal(fs.statSync(onDiskPath).size, genRes.body.fileSize);

      generatedVideoUrl = genRes.body.videoUrl;
      generatedSha256 = genRes.body.sha256;
      generatedFileSize = genRes.body.fileSize;
      generatedDimensions = genRes.body.dimensions;
      generatedDuration = genRes.body.durationSec;
    });

    // TEST-MS-10: Animation Persistence & Library Management
    let savedAnimationId = 0;

    await t.test('10. Persist generated animation to character library (TEST-MS-10)', async () => {
      const saveRes = await user1('POST', '/api/motion/save', {
        characterId: char1.id,
        title: 'Aria Dev — Theatrical Stage Wave',
        preset: 'Wave',
        description: 'Authentic 60-frame articulated arm wave with breathing counter-balance',
        videoUrl: generatedVideoUrl,
        durationSec: generatedDuration,
        fps: 30,
        width: generatedDimensions[0],
        height: generatedDimensions[1],
        sha256: generatedSha256,
        fileSize: generatedFileSize,
        modelUsed: 'AURAVO_LOCAL_KINEMATIC_PYTORCH_V1',
      });

      assert.equal(saveRes.status, 201);
      assert.equal(saveRes.body.ok, true);
      assert.ok(saveRes.body.animation.id > 0);
      assert.equal(saveRes.body.animation.characterId, char1.id);
      assert.equal(saveRes.body.animation.preset, 'Wave');
      assert.equal(saveRes.body.animation.sha256, generatedSha256);

      savedAnimationId = saveRes.body.animation.id;
    });

    // TEST-MS-11: Owner-Scoped Retrieval & Reopen
    await t.test('11. Reopen and inspect saved animation from library (TEST-MS-11)', async () => {
      const getRes = await user1('GET', `/api/motion/animations/${savedAnimationId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.animation.id, savedAnimationId);
      assert.equal(getRes.body.animation.characterId, char1.id);
      assert.equal(getRes.body.animation.sha256, generatedSha256);

      const listRes = await user1('GET', `/api/motion/animations?characterId=${char1.id}`);
      assert.equal(listRes.status, 200);
      assert.ok(Array.isArray(listRes.body.animations));
      assert.ok(listRes.body.animations.some((a: any) => a.id === savedAnimationId));
    });

    // TEST-MS-12: Cross-User Access Rejection (Tenant Isolation)
    await t.test('12. Multi-tenant isolation: User 2 cannot access or mutate User 1 animations (TEST-MS-12)', async () => {
      const getCross = await user2Client('GET', `/api/motion/animations/${savedAnimationId}`);
      assert.equal(getCross.status, 404);

      const listCross = await user2Client('GET', '/api/motion/animations');
      assert.equal(listCross.status, 200);
      assert.ok(!listCross.body.animations.some((a: any) => a.id === savedAnimationId));

      const delCross = await user2Client('DELETE', `/api/motion/animations/${savedAnimationId}`);
      assert.equal(delCross.status, 404);
    });

    // TEST-MS-13: Asset Access Control Hardening
    await t.test('13. Asset access control: unauthenticated & cross-tenant media access rejected (TEST-MS-13)', async () => {
      const anon = client(base);
      const videoFilename = path.basename(generatedVideoUrl);
      const imageFilename = path.basename(char1.referenceImage);

      const unauthVideo = await anon('GET', `/api/media/videos/${videoFilename}`);
      assert.equal(unauthVideo.status, 401);

      const unauthImg = await anon('GET', `/api/media/images/${imageFilename}`);
      assert.equal(unauthImg.status, 401);

      const unauthStorage = await anon('GET', `/storage/videos/${videoFilename}`);
      assert.equal(unauthStorage.status, 401);

      const crossImgReq = await user2Client('GET', `/api/media/images/${imageFilename}`);
      assert.equal(crossImgReq.status, 403);

      const crossVideoReq = await user2Client('GET', `/api/media/videos/${videoFilename}`);
      assert.equal(crossVideoReq.status, 403);

      const authVideoReq = await user1('GET', `/api/media/videos/${videoFilename}`);
      assert.equal(authVideoReq.status, 200);

      const authImgReq = await user1('GET', `/api/media/images/${imageFilename}`);
      assert.equal(authImgReq.status, 200);
    });

    // TEST-MS-14: Clean Deletion of Saved Animation
    await t.test('14. Delete saved animation from library (TEST-MS-14)', async () => {
      const delRes = await user1('DELETE', `/api/motion/animations/${savedAnimationId}`);
      assert.equal(delRes.status, 204);

      const getAfter = await user1('GET', `/api/motion/animations/${savedAnimationId}`);
      assert.equal(getAfter.status, 404);
    });

    // TEST-MS-15: Character Studio Regression Safety Check
    await t.test('15. Character Studio preservation and regression verification (TEST-MS-15)', async () => {
      const previewRes = await user1('POST', '/api/characters/preview-portrait', {
        name: 'Vespera',
        role: 'Futuristic Soloist',
        appearance: 'Cybernetic neon violet eyes, sleek silver bob haircut',
        clothingStyle: 'Reflective silver stage catsuit',
        testMock: true,
      });

      assert.equal(previewRes.status, 200);
      assert.equal(previewRes.body.ok, true);
      assert.ok(previewRes.body.portraitUrl);
      assert.ok(previewRes.body.identityTokens.length >= 2);
    });
  } finally {
    srv.close();
  }
});
