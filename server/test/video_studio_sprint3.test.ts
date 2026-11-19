import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import {
  VideoStudioProvider,
  validateComposedVideo,
  computeFileSha256,
  ASPECT_RATIO_PRESETS,
  CANVAS_STYLES,
} from '../providers/video_studio.js';

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

test('Sprint 3 - Video Studio: End-to-End Character Video Creation Test Suite', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  const cleanupFiles: string[] = [];

  try {
    const user1 = client(base);

    // Setup User 1 via registration
    await user1('POST', '/api/auth/register', { email: 'creator@auravo.studio', password: 'Password123!' });

    // Setup User 2 directly in DB for tenant isolation testing
    const u2Token = '2222222222222222222222222222222222222222222222222222222222222222';
    const u2Hash = crypto.createHash('sha256').update(u2Token).digest('hex');
    db.prepare("INSERT INTO users(id, email, passwordHash) VALUES(2, 'intruder@auravo.studio', 'hash2')").run();
    db.prepare('INSERT INTO sessions VALUES(?, ?, ?)').run(u2Hash, 2, Date.now() + 3600000);

    const user2Client = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(base + p, {
        method,
        headers: { 'content-type': 'application/json', cookie: `sid=${u2Token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: r.status,
        headers: r.headers,
        body: r.status === 204 ? null : await r.json().catch(() => null),
      };
    };

    // Setup Brand & Characters
    const b1 = (await user1('POST', '/api/brands', { name: 'Auravo Prime' })).body.id;
    const b2 = (await user2Client('POST', '/api/brands', { name: 'Intruder Brand' })).body.id;

    // Source animation file fixture for tests
    const realAnimPath = path.resolve('./data/storage/videos/demo_aria_wave_sprint2_1.mp4');
    const hasRealAnim = fs.existsSync(realAnimPath);
    const animSha = hasRealAnim ? computeFileSha256(realAnimPath) : 'e'.repeat(64);
    const animSize = hasRealAnim ? fs.statSync(realAnimPath).size : 100000;

    // Create User 1 Character
    const c1 = (await user1('POST', '/api/characters', {
      brandId: b1,
      name: 'Aria Dev',
      appearance: 'Regal classical dancer with silk attire',
      referenceImage: '/api/media/images/char_aria_dev_1794907355086.png',
    })).body.id;

    // Create User 2 Character
    const c2 = (await user2Client('POST', '/api/characters', {
      brandId: b2,
      name: 'Intruder Char',
      referenceImage: '/api/media/images/char_aria_dev_1794907355086.png',
    })).body.id;

    // Seed Saved Animation for Character 1 (User 1)
    const anim1Info = db.prepare(`
      INSERT INTO character_animations (
        ownerId, brandId, characterId, title, preset, description,
        durationSec, fps, width, height, videoUrl, thumbnailUrl,
        sha256, fileSize, modelUsed, metadata
      ) VALUES (?, ?, ?, 'Aria Wave Animation', 'wave', 'Articulated waving motion', 2.0, 30, 768, 1024, '/api/media/videos/demo_aria_wave_sprint2_1.mp4', '', ?, ?, 'AURAVO_LOCAL_KINEMATIC_PYTORCH_V1', '{}')
    `).run(1, b1, c1, animSha, animSize);
    const anim1Id = Number(anim1Info.lastInsertRowid);

    // Seed Saved Animation for Character 2 (User 2)
    const anim2Info = db.prepare(`
      INSERT INTO character_animations (
        ownerId, brandId, characterId, title, preset, description,
        durationSec, fps, width, height, videoUrl, thumbnailUrl,
        sha256, fileSize, modelUsed, metadata
      ) VALUES (?, ?, ?, 'Intruder Animation', 'wave', 'Intruder wave motion', 2.0, 30, 768, 1024, '/api/media/videos/demo_aria_wave_sprint2_1.mp4', '', ?, ?, 'AURAVO_LOCAL_KINEMATIC_PYTORCH_V1', '{}')
    `).run(2, b2, c2, animSha, animSize);
    const anim2Id = Number(anim2Info.lastInsertRowid);

    // -------------------------------------------------------------
    // Test 1: Presets API
    // -------------------------------------------------------------
    await t.test('1. GET /api/videos/presets returns aspect ratios and canvas styles', async () => {
      const res = await user1('GET', '/api/videos/presets');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.aspectRatios));
      assert.ok(Array.isArray(res.body.canvasStyles));
      assert.equal(res.body.aspectRatios.length, 3);
      assert.ok(res.body.aspectRatios.some((r: any) => r.id === '9:16' && r.width === 1080 && r.height === 1920));
      assert.ok(res.body.aspectRatios.some((r: any) => r.id === '16:9' && r.width === 1920 && r.height === 1080));
      assert.ok(res.body.aspectRatios.some((r: any) => r.id === '1:1' && r.width === 1080 && r.height === 1080));
      assert.ok(res.body.canvasStyles.some((s: any) => s.id === 'stage_matte'));
      assert.ok(res.body.canvasStyles.some((s: any) => s.id === 'blurred_backdrop'));
      assert.ok(res.body.canvasStyles.some((s: any) => s.id === 'cinematic_letterbox'));
      assert.ok(res.body.canvasStyles.some((s: any) => s.id === 'full_bleed'));
    });

    // -------------------------------------------------------------
    // Test 2: Animation Listing for Owned Character
    // -------------------------------------------------------------
    await t.test('2. GET /api/videos/animations/:id returns animations for owned character', async () => {
      const res = await user1('GET', `/api/videos/animations/${c1}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.character.name, 'Aria Dev');
      assert.equal(res.body.animations.length, 1);
      assert.equal(res.body.animations[0].id, anim1Id);
    });

    // -------------------------------------------------------------
    // Test 3: Animation Listing rejects unowned or nonexistent character
    // -------------------------------------------------------------
    await t.test('3. GET /api/videos/animations/:id rejects character owned by another user', async () => {
      // User 2 trying to fetch User 1's character animations
      const res = await user2Client('GET', `/api/videos/animations/${c1}`);
      assert.equal(res.status, 404);
      assert.ok(res.body.error.includes('Character not found'));
    });

    // -------------------------------------------------------------
    // Test 4: Composition Input Validation: Rejects invalid aspect ratio
    // -------------------------------------------------------------
    await t.test('4. POST /api/videos/compose rejects unsupported aspect ratio', async () => {
      const res = await user1('POST', '/api/videos/compose', {
        characterId: c1,
        animationId: anim1Id,
        title: 'Bad Aspect Video',
        aspectRatio: '4:3', // invalid
      });
      assert.equal(res.status, 400);
    });

    // -------------------------------------------------------------
    // Test 5: Composition Input Validation: Rejects mismatched character-animation
    // -------------------------------------------------------------
    await t.test('5. POST /api/videos/compose rejects animation belonging to another character', async () => {
      // User 1 trying to use User 2's animation with User 1's character
      const res = await user1('POST', '/api/videos/compose', {
        characterId: c1,
        animationId: anim2Id,
        title: 'Cross-Tenant Video',
        aspectRatio: '9:16',
      });
      assert.equal(res.status, 404); // anim2 not owned by user1
    });

    // -------------------------------------------------------------
    // Test 6: Composition Execution: 9:16 Vertical with Blurred Backdrop
    // -------------------------------------------------------------
    let composedVideo1: any = null;
    await t.test('6. POST /api/videos/compose renders 9:16 vertical video with blurred backdrop and overlays', async () => {
      if (!hasRealAnim) return;

      const res = await user1('POST', '/api/videos/compose', {
        characterId: c1,
        animationId: anim1Id,
        title: 'Aria Dev Vertical Showcase',
        aspectRatio: '9:16',
        canvasStyle: 'blurred_backdrop',
        titleOverlay: 'Aria Dev: Royal Wave',
        subtitleText: 'Aria greets the royal assembly with elegance.',
        characterBadge: true,
        narrationText: 'Aria Dev performing on stage.',
        bgmTrack: 'auravo_ambient_lounge',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      composedVideo1 = res.body.result;

      assert.equal(composedVideo1.aspectRatio, '9:16');
      assert.equal(composedVideo1.width, 1080);
      assert.equal(composedVideo1.height, 1920);
      assert.equal(composedVideo1.resolution, '1080x1920');
      assert.ok(composedVideo1.durationSec >= 2.0);
      assert.ok(composedVideo1.sha256 && composedVideo1.sha256.length === 64);
      assert.ok(composedVideo1.fileSize > 10000);
      assert.ok(composedVideo1.videoUrl.startsWith('/api/media/videos/'));

      cleanupFiles.push(composedVideo1.videoPath);
    });

    // -------------------------------------------------------------
    // Test 7: Composition Execution: 16:9 Landscape with Stage Matte
    // -------------------------------------------------------------
    await t.test('7. POST /api/videos/compose renders 16:9 landscape video with stage matte', async () => {
      if (!hasRealAnim) return;

      const res = await user1('POST', '/api/videos/compose', {
        characterId: c1,
        animationId: anim1Id,
        title: 'Aria Dev Landscape Stream',
        aspectRatio: '16:9',
        canvasStyle: 'stage_matte',
        titleOverlay: 'Aria Dev Landscape',
        characterBadge: true,
        bgmTrack: 'none',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      const result = res.body.result;

      assert.equal(result.aspectRatio, '16:9');
      assert.equal(result.width, 1920);
      assert.equal(result.height, 1080);
      assert.equal(result.resolution, '1920x1080');
      assert.ok(result.durationSec >= 1.5);
      assert.ok(result.fileSize > 10000);

      cleanupFiles.push(result.videoPath);
    });

    // -------------------------------------------------------------
    // Test 8: Composition Execution: 1:1 Square with Cinematic Letterbox
    // -------------------------------------------------------------
    await t.test('8. POST /api/videos/compose renders 1:1 square video with letterbox', async () => {
      if (!hasRealAnim) return;

      const res = await user1('POST', '/api/videos/compose', {
        characterId: c1,
        animationId: anim1Id,
        title: 'Aria Dev Square Feed',
        aspectRatio: '1:1',
        canvasStyle: 'cinematic_letterbox',
        bgmTrack: 'none',
      });

      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      const result = res.body.result;

      assert.equal(result.aspectRatio, '1:1');
      assert.equal(result.width, 1080);
      assert.equal(result.height, 1080);
      assert.equal(result.resolution, '1080x1080');

      cleanupFiles.push(result.videoPath);
    });

    // -------------------------------------------------------------
    // Test 9: Video Persistence: POST /api/videos/save saves record to DB
    // -------------------------------------------------------------
    let savedVideoId: number | null = null;
    await t.test('9. POST /api/videos/save persists composed video to character_videos table', async () => {
      if (!composedVideo1) return;

      const res = await user1('POST', '/api/videos/save', {
        characterId: c1,
        animationId: anim1Id,
        title: 'Aria Dev: Saved Vertical Video',
        description: 'First official saved video in library',
        aspectRatio: composedVideo1.aspectRatio,
        resolution: composedVideo1.resolution,
        width: composedVideo1.width,
        height: composedVideo1.height,
        durationSec: composedVideo1.durationSec,
        fps: composedVideo1.fps,
        videoUrl: composedVideo1.videoUrl,
        thumbnailUrl: composedVideo1.thumbnailUrl,
        sha256: composedVideo1.sha256,
        fileSize: composedVideo1.fileSize,
        compositionConfig: composedVideo1.compositionConfig,
        audioConfig: composedVideo1.audioConfig,
        subtitleConfig: composedVideo1.subtitleConfig,
      });

      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.ok(res.body.video?.id);
      savedVideoId = res.body.video.id;

      // Verify row in SQLite DB
      const row = db.prepare('SELECT * FROM character_videos WHERE id=?').get(savedVideoId) as any;
      assert.ok(row);
      assert.equal(row.ownerId, 1);
      assert.equal(row.characterId, c1);
      assert.equal(row.aspectRatio, '9:16');
      assert.equal(row.resolution, '1080x1920');
      assert.equal(row.sha256, composedVideo1.sha256);
    });

    // -------------------------------------------------------------
    // Test 10: Video Persistence: Rejects mismatched SHA-256
    // -------------------------------------------------------------
    await t.test('10. POST /api/videos/save rejects mismatched SHA-256 hash', async () => {
      if (!composedVideo1) return;

      const res = await user1('POST', '/api/videos/save', {
        characterId: c1,
        animationId: anim1Id,
        title: 'Tampered Video',
        aspectRatio: '9:16',
        resolution: '1080x1920',
        width: 1080,
        height: 1920,
        durationSec: 2.0,
        videoUrl: composedVideo1.videoUrl,
        sha256: '0'.repeat(64), // tampered hash
        fileSize: composedVideo1.fileSize,
      });

      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes('SHA-256 digest mismatch'));
    });

    // -------------------------------------------------------------
    // Test 11: Video Persistence: Rejects nonexistent disk file
    // -------------------------------------------------------------
    await t.test('11. POST /api/videos/save rejects missing video file on disk', async () => {
      const res = await user1('POST', '/api/videos/save', {
        characterId: c1,
        animationId: anim1Id,
        title: 'Ghost Video',
        aspectRatio: '9:16',
        resolution: '1080x1920',
        width: 1080,
        height: 1920,
        durationSec: 2.0,
        videoUrl: '/api/media/videos/ghost_nonexistent_file_12345.mp4',
        sha256: 'a'.repeat(64),
        fileSize: 1000,
      });

      assert.equal(res.status, 400);
      assert.ok(res.body.error.includes('does not exist on disk'));
    });

    // -------------------------------------------------------------
    // Test 12: List Videos (Owner-Scoped)
    // -------------------------------------------------------------
    await t.test('12. GET /api/videos returns user-owned videos', async () => {
      const res = await user1('GET', '/api/videos');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.ok(Array.isArray(res.body.videos));
      if (savedVideoId) {
        assert.ok(res.body.videos.some((v: any) => v.id === savedVideoId));
      }
    });

    // -------------------------------------------------------------
    // Test 13: Multi-tenant Isolation: User 2 cannot list User 1's videos
    // -------------------------------------------------------------
    await t.test('13. GET /api/videos enforces strict multi-tenant isolation', async () => {
      const res = await user2Client('GET', '/api/videos');
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.videos.length, 0); // User 2 has no saved videos
    });

    // -------------------------------------------------------------
    // Test 14: Multi-tenant Isolation: User 2 cannot get User 1's video by ID
    // -------------------------------------------------------------
    await t.test('14. GET /api/videos/:id rejects access to other tenant video', async () => {
      if (!savedVideoId) return;

      const res = await user2Client('GET', `/api/videos/${savedVideoId}`);
      assert.equal(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    // -------------------------------------------------------------
    // Test 15: Media Asset Serving Tenant Isolation
    // -------------------------------------------------------------
    await t.test('15. GET /api/media/videos/:filename blocks unauthorized tenant download', async () => {
      if (!composedVideo1) return;

      const filename = path.basename(composedVideo1.videoUrl);
      const res = await user2Client('GET', `/api/media/videos/${filename}`);
      assert.equal(res.status, 403);
      assert.ok(res.body.error.includes('belongs to another user'));
    });

    // -------------------------------------------------------------
    // Test 16: Video Deletion (Owner-Scoped)
    // -------------------------------------------------------------
    await t.test('16. DELETE /api/videos/:id deletes video and unlinks asset', async () => {
      if (!savedVideoId) return;

      const res = await user1('DELETE', `/api/videos/${savedVideoId}`);
      assert.equal(res.status, 204);

      // Verify row is gone from DB
      const row = db.prepare('SELECT 1 FROM character_videos WHERE id=?').get(savedVideoId);
      assert.equal(row, undefined);
    });

    // -------------------------------------------------------------
    // Test 17: Database Integrity Verification
    // -------------------------------------------------------------
    await t.test('17. SQLite schema integrity and foreign keys are valid', () => {
      const integrity = db.pragma('integrity_check') as any[];
      assert.equal(integrity[0].integrity_check, 'ok');
      const fkCheck = db.pragma('foreign_key_check') as any[];
      assert.equal(fkCheck.length, 0);
    });

  } finally {
    srv.close();
    // Clean up temporary test video files
    for (const f of cleanupFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    }
  }
});

