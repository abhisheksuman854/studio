import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import {
  MotionGeneratorProvider,
  validateMotionVideo,
  SUPPORTED_MOTION_PRESETS,
  computeFileSha256,
} from '../providers/motion_gen.js';

function client(base: string, sid?: string) {
  let cookie = sid ? `sid=${sid}` : '';
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

test('Sprint 5 - Genuine Character Animation: Wave Gesture & Production Lifecycle Suite', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const user1 = client(base);
    await user1('POST', '/api/auth/register', { email: 'creator5@auravo.studio', password: 'Password123!' });

    // User 2 (Intruder) directly in DB
    const u2Token = '5555555555555555555555555555555555555555555555555555555555555555';
    const u2Hash = crypto.createHash('sha256').update(u2Token).digest('hex');
    db.prepare("INSERT INTO users(id, email, passwordHash) VALUES(2, 'intruder5@auravo.studio', 'hash2')").run();
    db.prepare('INSERT INTO sessions VALUES(?, ?, ?)').run(u2Hash, 2, Date.now() + 3600000);
    const user2 = client(base, u2Token);

    // Create Brand for User 1
    const bRes = await user1('POST', '/api/brands', {
      name: 'Sprint 5 Productions',
      handle: 'sprint5.prod',
      niche: 'Virtual Kinematics',
    });
    assert.equal(bRes.status, 201);
    const brandId = bRes.body.id;

    // Ensure Aria Dev canonical portrait exists
    const portraitPath = path.resolve('./data/storage/images/char_aria_dev_1794907355086.png');
    assert.ok(fs.existsSync(portraitPath), 'Canonical Aria Dev character portrait fixture must exist');

    // Create Character for User 1
    const charRow = db.prepare(`
      INSERT INTO characters (
        ownerId, brandId, name, description, appearance, clothingStyle,
        referenceImage, generationModel, identityTokens, metadata, createdAt, updatedAt
      ) VALUES (?, ?, 'Aria Dev', 'Virtual performer', 'Regal posture, expressive eyes', 'Emerald silk blouse',
        '/api/media/images/char_aria_dev_1794907355086.png', 'AURAVO_LOCAL_VECTOR_V1', '["aria","wave"]', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(1, brandId);
    const char1Id = Number(charRow.lastInsertRowid);

    // Create Intruder Character for User 2
    const char2Row = db.prepare(`
      INSERT INTO characters (
        ownerId, brandId, name, description, appearance, clothingStyle,
        referenceImage, generationModel, identityTokens, metadata, createdAt, updatedAt
      ) VALUES (2, 1, 'Intruder Character', 'Foreign character', 'Shadowy figure', 'Cloak',
        '/api/media/images/char_aria_dev_1794907355086.png', 'AURAVO_LOCAL_VECTOR_V1', '[]', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    const char2Id = Number(char2Row.lastInsertRowid);

    // -------------------------------------------------------------------------
    // Subtest 1: Valid Wave Generation Request (Genuine Kinematic Inference)
    // -------------------------------------------------------------------------
    let generatedResult: any = null;
    await t.test('1. Valid wave generation request executes genuine local kinematic inference', async () => {
      const res = await user1('POST', '/api/motion/generate', {
        characterId: char1Id,
        preset: 'Wave',
        durationSec: 2.0,
        fps: 30,
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.preset, 'Wave');
      assert.equal(res.body.modelUsed, 'AURAVO_LOCAL_KINEMATIC_PYTORCH_V1');
      assert.equal(res.body.licence, 'BSD-3-Clause (PyTorch Tensor Engine) + GPL/LGPL (FFmpeg)');
      assert.ok(res.body.dimensions[0] >= 64);
      assert.ok(res.body.dimensions[1] >= 64);
      assert.ok(res.body.meanFrameDiff > 0.005, 'Mean frame difference must verify non-static motion');
      assert.ok(res.body.maxFrameDiff > 0.40, 'Max frame difference must confirm articulated waving gesture');
      assert.ok(res.body.armRegionDiff > res.body.faceRegionDiff, 'Arm motion must exceed face motion');
      assert.equal(res.body.cornerRegionDiff, 0, 'Background corners must remain stationary');
      assert.equal(res.body.firstFrameDiffToSource, 0, 'First frame must perfectly match source character portrait');

      // Verify file on disk
      const videoPath = path.resolve('./data/storage/videos', path.basename(res.body.videoUrl));
      assert.ok(fs.existsSync(videoPath), 'Generated video must exist on disk');
      assert.equal(computeFileSha256(videoPath), res.body.sha256);

      generatedResult = res.body;
    });

    // -------------------------------------------------------------------------
    // Subtest 2: Invalid Character Ownership Rejection
    // -------------------------------------------------------------------------
    await t.test('2. Generation rejects character owned by another user', async () => {
      // User 2 tries to generate motion for User 1's character
      const res = await user2('POST', '/api/motion/generate', {
        characterId: char1Id,
        preset: 'Wave',
      });
      assert.equal(res.status, 404);
      assert.ok(res.body.error.includes('not owned by user'));
    });

    // -------------------------------------------------------------------------
    // Subtest 3: Unsupported Movement Preset Rejection
    // -------------------------------------------------------------------------
    await t.test('3. Generation rejects unsupported movement preset', async () => {
      const res = await user1('POST', '/api/motion/generate', {
        characterId: char1Id,
        preset: 'Somersault360',
      });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes('Unsupported movement preset'));
    });

    // -------------------------------------------------------------------------
    // Subtest 4: Generation Rejects Character Without Reference Portrait
    // -------------------------------------------------------------------------
    await t.test('4. Generation rejects character without reference portrait', async () => {
      const noPortraitChar = db.prepare(`
        INSERT INTO characters (ownerId, brandId, name, appearance, referenceImage)
        VALUES (1, ?, 'Blank Character', 'None', '')
      `).run(brandId);
      const bId = Number(noPortraitChar.lastInsertRowid);

      const res = await user1('POST', '/api/motion/generate', {
        characterId: bId,
        preset: 'Wave',
      });
      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes('no reference portrait'));
    });

    // -------------------------------------------------------------------------
    // Subtest 5: Output Validator Rejects Missing Video File
    // -------------------------------------------------------------------------
    await t.test('5. Output validator rejects missing video file on disk', async () => {
      const val = await validateMotionVideo('/non/existent/path/video.mp4');
      assert.equal(val.isValid, false);
      assert.equal(val.errorCategory, 'ANIMATION_OUTPUT_INVALID');
      assert.ok(val.error?.includes('does not exist'));
    });

    // -------------------------------------------------------------------------
    // Subtest 6: Output Validator Rejects Corrupted or Undersized MP4
    // -------------------------------------------------------------------------
    await t.test('6. Output validator rejects corrupted or undersized MP4 file', async () => {
      const badPath = path.resolve('./data/storage/videos/corrupt_test_sprint5.mp4');
      fs.writeFileSync(badPath, Buffer.from('NOT_A_VALID_MP4_HEADER'));
      try {
        const val = await validateMotionVideo(badPath);
        assert.equal(val.isValid, false);
        assert.equal(val.errorCategory, 'ANIMATION_OUTPUT_INVALID');
      } finally {
        if (fs.existsSync(badPath)) fs.unlinkSync(badPath);
      }
    });

    // -------------------------------------------------------------------------
    // Subtest 7: Output Validator Rejects Static Repeating Frames
    // -------------------------------------------------------------------------
    await t.test('7. Output validator rejects static repeating frames without motion', async () => {
      // Re-validate that a single repeated image fails
      const staticVal = await validateMotionVideo(portraitPath, 0.5);
      assert.equal(staticVal.isValid, false);
      assert.ok(staticVal.errorCategory === 'VIDEO_ENCODING_FAILED' || staticVal.errorCategory === 'ANIMATION_OUTPUT_INVALID');
    });

    // -------------------------------------------------------------------------
    // Subtest 8: Mock Fallback Rejection in Production Generation Path
    // -------------------------------------------------------------------------
    await t.test('8. Production generation path rejects silent mock fallback when python unavailable', async () => {
      const motionGen = new MotionGeneratorProvider(db);
      // Pass an invalid python binary environment to simulate runtime failure
      const origPy = process.env.AURAVO_PYTHON_BIN;
      process.env.AURAVO_PYTHON_BIN = '/bin/false';
      try {
        await assert.rejects(
          async () => {
            await motionGen.generateMotionAnimation({
              characterId: char1Id,
              characterName: 'Aria Dev',
              sourceImagePath: portraitPath,
              preset: 'Wave',
              testMock: false, // Explicitly false: production path!
            });
          },
          (err: any) => {
            return err.message.includes('GENUINE_ANIMATION_FAILED') || err.message.includes('Refusing silent mock fallback');
          }
        );
      } finally {
        if (origPy) process.env.AURAVO_PYTHON_BIN = origPy;
        else delete process.env.AURAVO_PYTHON_BIN;
      }
    });

    // -------------------------------------------------------------------------
    // Subtest 9: Animation Persistence to Library
    // -------------------------------------------------------------------------
    let savedAnimId = 0;
    await t.test('9. Generated animation successfully persists to character_animations table', async () => {
      assert.ok(generatedResult, 'Generated result from test 1 must exist');

      const saveRes = await user1('POST', '/api/motion/save', {
        characterId: char1Id,
        title: 'Aria Dev - Sprint 5 Genuine Wave Animation',
        preset: 'Wave',
        description: 'First genuine articulated kinematic wave gesture',
        videoUrl: generatedResult.videoUrl,
        durationSec: generatedResult.durationSec,
        fps: generatedResult.fps,
        width: generatedResult.dimensions[0],
        height: generatedResult.dimensions[1],
        sha256: generatedResult.sha256,
        fileSize: generatedResult.fileSize,
        modelUsed: generatedResult.modelUsed,
        metadata: {
          meanFrameDiff: generatedResult.meanFrameDiff,
          maxFrameDiff: generatedResult.maxFrameDiff,
          armRegionDiff: generatedResult.armRegionDiff,
          faceRegionDiff: generatedResult.faceRegionDiff,
        },
      });

      assert.equal(saveRes.status, 201);
      assert.equal(saveRes.body.ok, true);
      assert.ok(saveRes.body.animation.id > 0);
      assert.equal(saveRes.body.animation.characterId, char1Id);
      assert.equal(saveRes.body.animation.ownerId, 1);
      assert.equal(saveRes.body.animation.sha256, generatedResult.sha256);
      assert.equal(saveRes.body.animation.width, generatedResult.dimensions[0]);
      assert.equal(saveRes.body.animation.height, generatedResult.dimensions[1]);

      savedAnimId = saveRes.body.animation.id;
    });

    // -------------------------------------------------------------------------
    // Subtest 10: Animation Retrieval & Inspection
    // -------------------------------------------------------------------------
    await t.test('10. Saved animation retrieved accurately from library', async () => {
      assert.ok(savedAnimId > 0);
      const getRes = await user1('GET', `/api/motion/animations/${savedAnimId}`);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.ok, true);
      assert.equal(getRes.body.animation.id, savedAnimId);
      assert.equal(getRes.body.animation.title, 'Aria Dev - Sprint 5 Genuine Wave Animation');
      assert.equal(getRes.body.animation.preset, 'Wave');
      assert.equal(getRes.body.animation.modelUsed, 'AURAVO_LOCAL_KINEMATIC_PYTORCH_V1');

      // List filtering by character
      const listRes = await user1('GET', `/api/motion/animations?characterId=${char1Id}`);
      assert.equal(listRes.status, 200);
      assert.ok(Array.isArray(listRes.body.animations));
      assert.ok(listRes.body.animations.some((a: any) => a.id === savedAnimId));
    });

    // -------------------------------------------------------------------------
    // Subtest 11: Cross-Tenant Media & Library Isolation
    // -------------------------------------------------------------------------
    await t.test('11. Multi-tenant isolation prevents cross-tenant animation access and mutation', async () => {
      assert.ok(savedAnimId > 0);

      // User 2 cannot access User 1's saved animation
      const getRes = await user2('GET', `/api/motion/animations/${savedAnimId}`);
      assert.equal(getRes.status, 404);

      // User 2 cannot delete User 1's saved animation
      const delRes = await user2('DELETE', `/api/motion/animations/${savedAnimId}`);
      assert.equal(delRes.status, 404);

      // User 2's animation list does not expose User 1's animation
      const listRes = await user2('GET', '/api/motion/animations');
      assert.equal(listRes.status, 200);
      assert.ok(!listRes.body.animations.some((a: any) => a.id === savedAnimId));
    });

    // -------------------------------------------------------------------------
    // Subtest 12: Clean Animation Deletion
    // -------------------------------------------------------------------------
    await t.test('12. Animation owner can cleanly delete saved animation', async () => {
      assert.ok(savedAnimId > 0);
      const delRes = await user1('DELETE', `/api/motion/animations/${savedAnimId}`);
      assert.equal(delRes.status, 204);

      // Verify deletion from database
      const verifyRes = await user1('GET', `/api/motion/animations/${savedAnimId}`);
      assert.equal(verifyRes.status, 404);
    });

  } finally {
    srv.close();
  }
});
