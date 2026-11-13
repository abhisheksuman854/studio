import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { LivePortraitFaceAnimatorProvider } from '../providers/face_animator.js';

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

test('LivePortrait Face Animator - Unit Local Motion Synthesis', async () => {
  const provider = new LivePortraitFaceAnimatorProvider();

  // Create a sample portrait image for test
  const tempDir = path.resolve('./data/storage/images');
  fs.mkdirSync(tempDir, { recursive: true });
  const testImagePath = path.join(tempDir, `test_unit_face_${Date.now()}.jpg`);

  // Ensure test image exists (copy priya_portrait.jpg or create dummy)
  const starterImage = path.join(tempDir, 'priya_portrait.jpg');
  if (fs.existsSync(starterImage)) {
    fs.copyFileSync(starterImage, testImagePath);
  } else {
    // 1-pixel or simple dummy buffer
    fs.writeFileSync(testImagePath, Buffer.from('dummy'));
  }

  const outputVideo = path.resolve(`./data/storage/videos/test_unit_animated_${Date.now()}.mp4`);

  try {
    const resultPath = await provider.animateFace({
      sourceImagePath: testImagePath,
      motionPreset: 'natural_speaking',
      durationSec: 2,
      outputVideoPath: outputVideo,
    });

    assert.equal(resultPath, outputVideo);
    assert.ok(fs.existsSync(resultPath));
    const stats = fs.statSync(resultPath);
    assert.ok(stats.size > 2000, `Output video should be valid MP4 size, got ${stats.size} bytes`);
  } finally {
    if (fs.existsSync(testImagePath)) fs.unlinkSync(testImagePath);
    if (fs.existsSync(outputVideo)) fs.unlinkSync(outputVideo);
  }
});

test('LivePortrait Face Animation API - HTTP Endpoints', async () => {
  const srv = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const c = client(base);

    // 1. Register & Setup Brand
    await c('POST', '/api/auth/register', { email: 'director@auravo.studio', password: 'password123' });
    const b = await c('POST', '/api/brands', {
      name: 'Auravo LivePortrait Studio',
      handle: 'auravo.liveportrait',
      niche: 'Kathak & Stage Fusion',
    });
    const brandId = b.body.id;

    // 2. Generate Character Entity
    const charRes = await c('POST', '/api/characters/generate-entity', {
      brandId,
      name: 'Aria Dev',
      appearance: 'Radiant dancer with almond hazel eyes, high cheekbones',
      clothingStyle: 'Midnight sapphire silk gown',
      personality: 'Mesmerizing stage presence',
    });
    assert.equal(charRes.status, 201);
    const charId = charRes.body.character.id;

    // 3. Request LivePortrait Face Animation
    const animRes = await c('POST', `/api/characters/${charId}/animate-face`, {
      motionPreset: 'natural_speaking',
      durationSec: 2,
    });

    assert.equal(animRes.status, 200);
    assert.equal(animRes.body.ok, true);
    assert.equal(animRes.body.characterId, charId);
    assert.ok(animRes.body.videoUrl.startsWith('/api/media/videos/'));

    // 4. Test Error Handling (Invalid Character ID)
    const errRes = await c('POST', '/api/characters/9999/animate-face', {
      motionPreset: 'natural_speaking',
      durationSec: 2,
    });
    assert.equal(errRes.status, 404);
  } finally {
    srv.close();
  }
});
