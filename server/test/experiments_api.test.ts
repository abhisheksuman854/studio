import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { sanitizeJobError } from '../jobs.js';

function makeClient(base: string, initialCookie = '') {
  let cookie = initialCookie;
  return async (method: string, path: string, body?: any) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const contentType = r.headers.get('content-type') || '';
    return {
      status: r.status,
      contentType,
      body: contentType.includes('application/json') ? await r.json() : await r.arrayBuffer()
    };
  };
}

test('Experiments API - Authentication, Tenant Isolation & Evidence Security', async (t) => {
  const db = openDb(':memory:');
  const app = createApp(db);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
    db.close();
  });

  await t.test('Unauthenticated requests to /api/experiments are rejected with 401', async () => {
    const unauthClient = makeClient(baseUrl);
    const res = await unauthClient('GET', '/api/experiments');
    assert.equal(res.status, 401);
  });

  await t.test('Unauthenticated requests to /api/experiments/live-jobs are rejected with 401', async () => {
    const unauthClient = makeClient(baseUrl);
    const res = await unauthClient('GET', '/api/experiments/live-jobs');
    assert.equal(res.status, 401);
  });

  // Register User A (owner)
  const clientA = makeClient(baseUrl);
  const regA = await clientA('POST', '/api/auth/register', { email: 'usera@example.com', password: 'password123' });
  assert.equal(regA.status, 201);

  await t.test('Authenticated GET /api/experiments returns full metadata with harmonized vocabulary', async () => {
    const res = await clientA('GET', '/api/experiments');
    assert.equal(res.status, 200);
    const data = res.body as any;

    // Generation Monitor Capabilities
    assert.ok(data.generationMonitor);
    const monCaps = data.generationMonitor.capabilities;
    assert.equal(monCaps.length, 5);
    const charGen = monCaps.find((c: any) => c.id === 'char_img_gen');
    assert.equal(charGen.status, 'DEMONSTRATED_WITH_LIMITATIONS');
    const charId = monCaps.find((c: any) => c.id === 'char_identity_consistency');
    assert.equal(charId.status, 'EXPERIMENTAL');
    const motion = monCaps.find((c: any) => c.id === 'actual_char_motion');
    assert.equal(motion.status, 'NOT_STARTED');
    const video = monCaps.find((c: any) => c.id === 'ai_char_video_gen');
    assert.equal(video.status, 'NOT_STARTED');
    const mp4 = monCaps.find((c: any) => c.id === 'mp4_composition_export');
    assert.equal(mp4.status, 'DEMONSTRATED');

    // Capabilities Matrix
    assert.ok(Array.isArray(data.capabilities));
    assert.equal(data.capabilities.length, 8);
    assert.ok(data.capabilities.some((c: any) => c.id === 'local_character_gen' && c.status === 'DEMONSTRATED_WITH_LIMITATIONS'));
    assert.ok(data.capabilities.some((c: any) => c.id === 'identity_consistency' && c.status === 'EXPERIMENTAL'));
    assert.ok(data.capabilities.some((c: any) => c.id === 'genuine_ai_animation' && (c.status === 'NOT_IMPLEMENTED' || c.status === 'NOT_STARTED')));

    // Pipeline
    assert.ok(Array.isArray(data.pipeline));
    assert.equal(data.pipeline.length, 6);
    assert.equal(data.pipeline[0].name, 'Character Generation');
    assert.equal(data.pipeline[4].name, 'Video Composition & Audio Sync');

    // Verified Checksums in Experiments Registry
    assert.ok(Array.isArray(data.experiments));
    assert.ok(data.experiments.length >= 8);

    const p2b1 = data.experiments.find((e: any) => e.phase === 'Phase 2B.1');
    assert.ok(p2b1);
    assert.equal(p2b1.outputArtifacts[0].sha256, 'ab5d2287aedf89ed396f0a24e7efe8fc783c495add02768a688a97ed3f2289fe');
    assert.ok(p2b1.licenceAssessment.includes('CreativeML Open RAIL++-M'));

    const p2b4b = data.experiments.find((e: any) => e.phase === 'Phase 2B.4B');
    assert.ok(p2b4b);
    assert.equal(p2b4b.outputArtifacts[0].sha256, '6456d9c9299d5b08d31885e41fb525845b49e566ec0f1c1c0c71d91a48773466');

    // Motion Studio Progress
    const motionProg = data.generationMonitor.motionProgress;
    assert.ok(motionProg);
    assert.deepEqual(motionProg.presetsSupported, ['natural_speaking', 'dramatic_intro', 'subtle_gaze', 'expressive_recital']);
    assert.ok(motionProg.characterAnimationStatus.includes('2D_FACIAL_WARPING_ONLY'));
  });

  await t.test('GET /api/experiments/live-jobs enforces tenant isolation across users', async () => {
    // Look up User A's ID
    const userARow = db.prepare('SELECT id FROM users WHERE email = ?').get('usera@example.com') as { id: number };
    assert.ok(userARow);

    // Create User B session directly in SQLite
    const userBToken = crypto.randomBytes(32).toString('hex');
    const userBId = db.prepare('INSERT INTO users(email, passwordHash) VALUES(?, ?)').run('userb@example.com', 'fakehash').lastInsertRowid as number;
    db.prepare('INSERT INTO sessions VALUES(?, ?, ?)').run(
      crypto.createHash('sha256').update(userBToken).digest('hex'),
      userBId,
      Date.now() + 7 * 864e5
    );
    const clientB = makeClient(baseUrl, `sid=${userBToken}`);

    // Insert a job owned by User A and another owned by User B
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO jobs (id, ownerId, type, status, inputPayload, currentStage, progress, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('job-user-a', userARow.id, 'video_render', 'completed', '{}', 'export', 100, now, now);

    db.prepare(`
      INSERT INTO jobs (id, ownerId, type, status, inputPayload, currentStage, progress, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('job-user-b', userBId, 'image_generation', 'running', '{}', 'denoising', 50, now, now);

    // User A query should only see User A's job
    const resA = await clientA('GET', '/api/experiments/live-jobs');
    assert.equal(resA.status, 200);
    const jobsA = (resA.body as any).jobs;
    assert.equal((resA.body as any).liveBackendAvailable, true);
    assert.equal(jobsA.length, 1);
    assert.equal(jobsA[0].id, 'job-user-a');

    // User B query should only see User B's job
    const resB = await clientB('GET', '/api/experiments/live-jobs');
    assert.equal(resB.status, 200);
    const jobsB = (resB.body as any).jobs;
    assert.equal((resB.body as any).liveBackendAvailable, true);
    assert.equal(jobsB.length, 1);
    assert.equal(jobsB[0].id, 'job-user-b');
  });

  await t.test('GET /api/experiments/artifact/:phase/:file streams approved PNG', async () => {
    const res = await clientA('GET', '/api/experiments/artifact/phase2b_2/persona_b_latin.png');
    assert.equal(res.status, 200);
    assert.ok(res.contentType.includes('image/png'));
    const buf = Buffer.from(res.body as ArrayBuffer);
    assert.equal(buf.length, 1340421); // Verified byte size
  });

  await t.test('GET /api/experiments/artifact/:phase/:file strictly blocks JSON files (telemetry protection)', async () => {
    const res = await clientA('GET', '/api/experiments/artifact/phase2b_5_3/telemetry.json');
    assert.equal(res.status, 400);
    assert.equal((res.body as any).error, 'Invalid or unsupported artifact file type');
  });

  await t.test('GET /api/experiments/artifact/:phase/:file rejects path traversal and unapproved files', async () => {
    const res1 = await clientA('GET', '/api/experiments/artifact/phase2b_2/..%2f..%2fetc%2fpasswd.png');
    assert.equal(res1.status, 400);

    const res2 = await clientA('GET', '/api/experiments/artifact/phase2b_2/unapproved_image.png');
    assert.equal(res2.status, 404);
  });

  await t.test('Job error sanitization strips host paths, traces, and sanitizes live-job responses', async () => {
    const userARow = db.prepare('SELECT id FROM users WHERE email = ?').get('usera@example.com') as { id: number };
    const now = new Date().toISOString();

    // Direct unit test of sanitizeJobError
    assert.equal(sanitizeJobError(null), null);
    assert.equal(sanitizeJobError(''), null);
    assert.equal(sanitizeJobError('RENDER_FAILED'), 'RENDER_FAILED');
    assert.equal(sanitizeJobError('Error: /Users/abhisheksuman/studio/data/storage/videos/err.mp4: libx264 codec failed'), 'RENDER_FAILED');
    assert.equal(sanitizeJobError('Error: /Users/abhisheksuman/models/sdxl/unet.safetensors failed during denoise'), 'GENERATION_FAILED');
    assert.equal(sanitizeJobError('Error: ECONNREFUSED 127.0.0.1:8000 gpu worker unreachable'), 'PROVIDER_UNAVAILABLE');
    assert.equal(sanitizeJobError('Error: content item missing or invalid scene input'), 'INVALID_INPUT');
    assert.equal(sanitizeJobError('Some unexpected uncaught exception in worker'), 'INTERNAL_ERROR');

    // Insert a failed job into database with raw host paths and FFmpeg stderr
    db.prepare(`
      INSERT INTO jobs (id, ownerId, type, status, inputPayload, currentStage, error, progress, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'job-err-test',
      userARow.id,
      'video_render',
      'FAILED',
      '{}',
      'Execution failed',
      '/Users/abhisheksuman/Documents/GitHub/studio/data/storage/videos/out.mp4: ffmpeg exited with code 1',
      25,
      now,
      now
    );

    // Query via GET /api/experiments/live-jobs
    const resLive = await clientA('GET', '/api/experiments/live-jobs');
    assert.equal(resLive.status, 200);
    const jobRecord = (resLive.body as any).jobs.find((j: any) => j.id === 'job-err-test');
    assert.ok(jobRecord);
    assert.equal(jobRecord.error, 'RENDER_FAILED');
    assert.ok(!jobRecord.error.includes('/Users/'));
    assert.ok(!jobRecord.error.includes('abhisheksuman'));

    // Query via GET /api/jobs
    const resJobs = await clientA('GET', '/api/jobs');
    assert.equal(resJobs.status, 200);
    const jobInList = (resJobs.body as any).find((j: any) => j.id === 'job-err-test');
    assert.ok(jobInList);
    assert.equal(jobInList.error, 'RENDER_FAILED');

    // Query via GET /api/jobs/:id
    const resJobSingle = await clientA('GET', '/api/jobs/job-err-test');
    assert.equal(resJobSingle.status, 200);
    assert.equal((resJobSingle.body as any).error, 'RENDER_FAILED');

    // Verify successful job has error: null
    const resSuccessSingle = await clientA('GET', '/api/jobs/job-user-a');
    assert.equal(resSuccessSingle.status, 200);
    assert.equal((resSuccessSingle.body as any).error, null);
  });

  await t.test('Model license registry correctly references CreativeML Open RAIL++-M for all SDXL Base 1.0 experiments', async () => {
    const res = await clientA('GET', '/api/experiments');
    assert.equal(res.status, 200);
    const experiments = (res.body as any).experiments;

    const sdxlPhases = ['Phase 2B.1', 'Phase 2B.2', 'Phase 2B.3', 'Phase 2B.4B', 'Phase 2B.5.3', 'Phase 2B.5.4'];
    for (const phase of sdxlPhases) {
      const exp = experiments.find((e: any) => e.phase === phase);
      assert.ok(exp, `Missing experiment for ${phase}`);
      assert.ok(
        exp.licenceAssessment.includes('CreativeML Open RAIL++-M') || exp.licenceAssessment.includes('OpenRAIL++-M'),
        `Expected OpenRAIL++-M in licenceAssessment for ${phase}, got: ${exp.licenceAssessment}`
      );
      assert.ok(
        !exp.licenceAssessment.includes('Stability AI Open Model License 0.9.0'),
        `Unexpected Stability AI Open Model License 0.9.0 in ${phase}`
      );
    }
  });

  await t.test('GET /api/experiments/artifact/:phase/:file rejects physical symlinks pointing outside storage directory', async () => {
    // Set up temp models directory and external secret directory
    const tempModelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auravo-models-test-'));
    const tempSecretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auravo-secret-test-'));
    const secretFile = path.join(tempSecretDir, 'host_secret.png');
    fs.writeFileSync(secretFile, Buffer.from('FAKE_SECRET_IMAGE_BYTES'));

    const phaseDir = path.join(tempModelsDir, 'phase2b_2');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Create a symlink pointing to the external file
    const symlinkTarget = path.join(phaseDir, 'persona_a_south_asian.png');
    fs.symlinkSync(secretFile, symlinkTarget);

    // Launch a dedicated app instance pointing to the temp models directory
    const symlinkApp = createApp(db, { modelsDir: tempModelsDir });
    const symlinkServer = symlinkApp.listen(0);
    const symlinkPort = (symlinkServer.address() as AddressInfo).port;
    const symlinkBase = `http://127.0.0.1:${symlinkPort}`;

    try {
      const authClient = makeClient(symlinkBase);
      const loginRes = await authClient('POST', '/api/auth/login', { email: 'usera@example.com', password: 'password123' });
      assert.equal(loginRes.status, 200);

      // Request the symlinked artifact - MUST be rejected with HTTP 400
      const symlinkRes = await authClient('GET', '/api/experiments/artifact/phase2b_2/persona_a_south_asian.png');
      assert.equal(symlinkRes.status, 400);
      assert.ok(
        (symlinkRes.body as any).error.includes('Symbolic links are not permitted') ||
        (symlinkRes.body as any).error.includes('Symbolic links or directory escapes are not permitted')
      );

      // Replace the symlink with a real regular file
      fs.unlinkSync(symlinkTarget);
      fs.writeFileSync(symlinkTarget, Buffer.from('REAL_AUTHORIZED_IMAGE_BYTES'));

      // Request again - MUST succeed with HTTP 200
      const realRes = await authClient('GET', '/api/experiments/artifact/phase2b_2/persona_a_south_asian.png');
      assert.equal(realRes.status, 200);
      assert.ok(realRes.contentType.includes('image/png'));
      const buf = Buffer.from(realRes.body as ArrayBuffer);
      assert.equal(buf.toString(), 'REAL_AUTHORIZED_IMAGE_BYTES');
    } finally {
      symlinkServer.close();
      fs.rmSync(tempModelsDir, { recursive: true, force: true });
      fs.rmSync(tempSecretDir, { recursive: true, force: true });
    }
  });

  await t.test('POST /api/content/:id/attach-dance-reference returns 410 REFERENCE_VIDEO_UPLOAD_DISABLED fail-closed', async () => {
    // Test with youtubeUrl
    const resYt = await clientA('POST', '/api/content/1/attach-dance-reference', {
      youtubeUrl: 'https://youtube.com/shorts/sample123',
    });
    assert.equal(resYt.status, 410);
    assert.equal((resYt.body as any).error, 'REFERENCE_VIDEO_UPLOAD_DISABLED');

    // Test with videoUrl
    const resUrl = await clientA('POST', '/api/content/1/attach-dance-reference', {
      videoUrl: 'https://example.com/dance.mp4',
    });
    assert.equal(resUrl.status, 410);
    assert.equal((resUrl.body as any).error, 'REFERENCE_VIDEO_UPLOAD_DISABLED');

    // Test with videoBase64
    const resB64 = await clientA('POST', '/api/content/1/attach-dance-reference', {
      videoBase64: 'data:video/mp4;base64,AAAA',
      filename: 'sample.mp4',
    });
    assert.equal(resB64.status, 410);
    assert.equal((resB64.body as any).error, 'REFERENCE_VIDEO_UPLOAD_DISABLED');

    // Test with empty payload
    const resEmpty = await clientA('POST', '/api/content/1/attach-dance-reference', {});
    assert.equal(resEmpty.status, 410);
    assert.equal((resEmpty.body as any).error, 'REFERENCE_VIDEO_UPLOAD_DISABLED');
  });
});
