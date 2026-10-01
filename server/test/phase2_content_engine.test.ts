import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { OriginalityEngine } from '../providers/originality.js';
import { generateSrtContent } from '../providers/video.js';

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

test('Originality Engine - similarity and repetition detection', () => {
  const history = [
    { title: 'Auravo: The Hidden Tempo', premise: 'A dancer discovers a hidden tempo behind the stage walls.' },
    { title: 'Auravo: Shadow & Spotlight', premise: 'A silhouette routine performed under dramatic side-lighting.' },
  ];

  // Highly similar concept
  const checkRepetitive = OriginalityEngine.evaluateAgainstHistory(
    'Auravo: The Hidden Tempo Variation',
    'A dancer discovers a secret musical tempo behind the stage walls.',
    history
  );
  assert.equal(checkRepetitive.isRepetitive, true);
  assert.ok(checkRepetitive.score < 60);
  assert.ok(checkRepetitive.warning?.includes('similarity to previous content'));

  // Completely distinct concept
  const checkUnique = OriginalityEngine.evaluateAgainstHistory(
    'SciFi Future: Neon Cyber Overture',
    'Robotic synthesizers pulse through an abandoned subterranean server room.',
    history
  );
  assert.equal(checkUnique.isRepetitive, false);
  assert.ok(checkUnique.score > 80);
});

test('Subtitle SRT Generator', () => {
  const scenes = [
    { narration: 'First scene hook text.', durationSec: 5 },
    { narration: 'Second scene conflict text.', durationSec: 10 },
  ];
  const srt = generateSrtContent(scenes);
  assert.ok(srt.includes('1\n00:00:00,000 --> 00:00:05,000\nFirst scene hook text.'));
  assert.ok(srt.includes('2\n00:00:05,000 --> 00:00:15,000\nSecond scene conflict text.'));
});

test('Phase 2 Content Engine - Ideas, 5-Scene Stories, and Full Workflow', async () => {
  const srv = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const c = client(base);

    // 1. Setup User & Brand
    await c('POST', '/api/auth/register', { email: 'creator@auravo.studio', password: 'password123' });
    const b = await c('POST', '/api/brands', {
      name: 'Auravo',
      handle: 'auravo.studio',
      niche: 'Entertainment & Stage Performance',
      tone: 'elegant, confident, moody, sensual but classy',
      preferredTopics: ['cabaret and stage-style dance', 'dramatic lighting', 'choreography concepts'],
      prohibitedTopics: ['nudity', 'explicit content'],
    });
    assert.equal(b.status, 201);
    const brandId = b.body.id;

    // 2. Character creation
    const char = await c('POST', '/api/characters', {
      brandId,
      name: 'Elena Vance',
      personality: 'Mysterious, confident, magnetic stage presence',
      appearance: 'Tall, striking eyes, vintage silhouette',
      clothingStyle: 'Midnight velvet dress and theatrical gloves',
      visualPrompt: 'Elena Vance standing on illuminated wooden stage, high contrast rim lighting',
      negativePrompt: 'blurry, cartoonish, low resolution',
    });
    assert.equal(char.status, 201);
    assert.equal(char.body.name, 'Elena Vance');

    // 3. Generate Ideas
    const ideasRes = await c('POST', '/api/ideas/generate', { brandId, count: 3 });
    assert.equal(ideasRes.status, 201);
    assert.equal(ideasRes.body.length, 3);
    assert.ok(ideasRes.body[0].potentialScore >= 70);
    assert.ok(ideasRes.body[0].originalityScore >= 70);
    const firstIdea = ideasRes.body[0];

    // 4. Accept Idea -> Generate 5-Scene Script
    const acceptRes = await c('POST', `/api/ideas/${firstIdea.id}/accept`);
    assert.equal(acceptRes.status, 201);
    assert.ok(acceptRes.body.contentItemId);
    assert.ok(acceptRes.body.scriptId);
    assert.equal(acceptRes.body.story.scenes.length, 5);

    // 5. Query Full Content Item Details
    const fullRes = await c('GET', `/api/content/${acceptRes.body.contentItemId}/full`);
    assert.equal(fullRes.status, 200);
    assert.equal(fullRes.body.scenes.length, 5);
    assert.ok(fullRes.body.originalityReport);

    // 6. Execute Render Pipeline (audio, 9:16 images, srt, mp4)
    const renderRes = await c('POST', `/api/content/${acceptRes.body.contentItemId}/render`);
    assert.equal(renderRes.status, 200);
    assert.equal(renderRes.body.status, 'READY_FOR_REVIEW');
    assert.ok(renderRes.body.videoPath);
    assert.ok(renderRes.body.totalDuration > 0);

    // 7. Verify Assets Saved
    const finalFull = await c('GET', `/api/content/${acceptRes.body.contentItemId}/full`);
    assert.equal(finalFull.body.status, 'READY_FOR_REVIEW');
    assert.ok(finalFull.body.assets.some((a: any) => a.type === 'VIDEO'));
    assert.ok(finalFull.body.assets.some((a: any) => a.type === 'IMAGE'));
    assert.ok(finalFull.body.assets.some((a: any) => a.type === 'AUDIO'));
    assert.ok(finalFull.body.assets.some((a: any) => a.type === 'SUBTITLE'));
  } finally {
    srv.close();
  }
});
