import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { QualityGateEngine } from '../providers/quality_gate.js';
import { PlatformAdaptationEngine } from '../providers/platform_adaptation.js';

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

test('Platform Adaptation Engine - YouTube, Instagram, TikTok derivatives', () => {
  const brand = {
    id: 1,
    name: 'Auravo',
    handle: '@auravo.studio',
    niche: 'Entertainment & Stage Performance',
    preferredTopics: ['cabaret and stage dance', 'choreography'],
    prohibitedTopics: ['nudity'],
  };

  const script = {
    title: 'The Hidden Tempo',
    hook: 'They say the stage only reveals its true secret when the spotlight cuts through the silence.',
    premise: 'A dancer discovers a secret tempo behind the theater walls.',
    targetDurationSec: 45,
  };

  const scenes = [{ sceneOrder: 1, narration: script.hook }];

  const adapted = PlatformAdaptationEngine.adapt(brand, script, scenes);
  assert.ok(adapted.youtube.title?.includes('#Shorts'));
  assert.ok(adapted.youtube.caption.toLowerCase().includes('subscribe'));
  assert.ok(adapted.instagram.caption.toLowerCase().includes('reel'));
  assert.ok(adapted.instagram.hashtags.includes('reelsinstagram'));
  assert.ok(adapted.tiktok.caption.includes('#fyp'));
  assert.equal(adapted.tiktok.aiDisclosure, true);
});

test('Quality Gate Engine - Safety policy & Copyright risk verification', () => {
  const brand = {
    id: 1,
    name: 'Auravo',
    preferredTopics: ['stage dance'],
    prohibitedTopics: ['nudity', 'sheer or see-through clothing', 'explicit content'],
  };

  // 1. Non-compliant content with sensitive keywords
  const unsafeReport = QualityGateEngine.evaluate({
    brand,
    script: { title: 'Sensual Dance', premise: 'A dancer performing on Hindi song tip tip barsa paani with wet transparent saree', targetDurationSec: 45 },
    scenes: [{ sceneOrder: 1, narration: 'Dance scene', visualPrompt: 'dancer with transparent saree', durationSec: 10 }],
    assets: [],
    history: [],
  });

  assert.equal(unsafeReport.passed, false);
  assert.equal(unsafeReport.canPublish, false);
  assert.ok(unsafeReport.checks.some((c) => c.category === 'SAFETY' && c.status === 'FAIL'));
  assert.ok(unsafeReport.checks.some((c) => c.category === 'COPYRIGHT' && c.status === 'WARN'));

  // 2. Clean compliant content
  const safeReport = QualityGateEngine.evaluate({
    brand,
    script: { title: 'The Golden Velvet Solo', premise: 'An elegant stage choreography routine with dramatic spotlights', targetDurationSec: 45 },
    scenes: [{ sceneOrder: 1, narration: 'Opening hook', visualPrompt: 'Silhouette dancer under golden overhead spotlight', durationSec: 45 }],
    assets: [
      { type: 'VIDEO', filePath: '/fake/video.mp4' },
      { type: 'AUDIO', filePath: '/fake/audio.mp3' },
      { type: 'SUBTITLE', filePath: '/fake/sub.srt' },
    ],
    history: [],
  });

  assert.equal(safeReport.checks.find((c) => c.name === 'Brand Safety & Policy Compliance')?.status, 'PASS');
  assert.equal(safeReport.checks.find((c) => c.name === 'Copyright & Monetization Risk')?.status, 'PASS');
});

test('Phase 3 - Quality Gate, Approval, Scene Regeneration & Publishing Calendar API', async () => {
  const srv = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const c = client(base);
    await c('POST', '/api/auth/register', { email: 'owner@auravo.studio', password: 'password123' });
    const b = await c('POST', '/api/brands', {
      name: 'Auravo',
      handle: 'auravo.studio',
      preferredTopics: ['choreography', 'stage dance'],
      prohibitedTopics: ['nudity', 'transparent clothing'],
    });
    const brandId = b.body.id;

    // 1. Create custom story
    const customRes = await c('POST', '/api/content/custom', {
      brandId,
      title: 'Midnight Stage Overture',
      premise: 'A dramatic solo dancer uncovering an impossible tempo on a dimly lit theater stage.',
    });
    assert.equal(customRes.status, 201);
    const contentId = customRes.body.contentItemId;

    // 2. Evaluate Quality Gate
    const qgRes = await c('POST', `/api/content/${contentId}/quality-gate`);
    assert.equal(qgRes.status, 200);
    assert.ok(qgRes.body.checks.length >= 4);

    // 3. Regenerate single scene beat
    const fullRes = await c('GET', `/api/content/${contentId}/full`);
    const firstScene = fullRes.body.scenes[0];
    const regenRes = await c('POST', `/api/content/${contentId}/regenerate-scene`, { sceneId: firstScene.id });
    assert.equal(regenRes.status, 200);
    assert.notEqual(regenRes.body.narration, '');

    // 4. Render video and approve
    await c('POST', `/api/content/${contentId}/render`);
    const approveRes = await c('POST', `/api/content/${contentId}/approve`);
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.status, 'APPROVED_FOR_PUBLISH');

    // 5. Schedule to Publishing Calendar for ALL platforms
    const scheduleRes = await c('POST', `/api/content/${contentId}/schedule`, {
      platform: 'ALL',
      scheduledAt: '2026-10-01 18:00',
    });
    assert.equal(scheduleRes.status, 201);
    assert.equal(scheduleRes.body.schedules.length, 3); // YouTube, Instagram, TikTok

    // 6. Query Calendar
    const calRes = await c('GET', '/api/schedules');
    assert.equal(calRes.status, 200);
    assert.equal(calRes.body.length, 3);
    assert.ok(calRes.body.some((s: any) => s.platform === 'YOUTUBE'));
    assert.ok(calRes.body.some((s: any) => s.platform === 'INSTAGRAM'));
    assert.ok(calRes.body.some((s: any) => s.platform === 'TIKTOK'));

    // 7. Cancel a schedule slot
    const cancelRes = await c('DELETE', `/api/schedules/${calRes.body[0].id}`);
    assert.equal(cancelRes.status, 200);
  } finally {
    srv.close();
  }
});
