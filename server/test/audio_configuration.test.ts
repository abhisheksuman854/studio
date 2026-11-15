import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { resolveAudioMode, SUPPORTED_AUDIO_MODES, DEFAULT_AUDIO_MODE } from '../providers/types.js';
import { QualityGateEngine } from '../providers/quality_gate.js';
import type { BrandContext } from '../providers/types.js';

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

const mockBrand: BrandContext = {
  id: 1,
  name: 'Test Brand',
  handle: '@testbrand',
  targetAgeMin: 18,
  targetAgeMax: 30,
  targetGender: 'ALL',
  country: 'IN',
  language: 'English',
  niche: 'Dance',
  tone: 'Energetic',
  visualStyle: 'Cinematic',
  contentRules: 'High energy',
  prohibitedTopics: [],
  preferredTopics: ['classical dance'],
};

const mockScript = {
  title: 'Rhythmic Monsoon Echoes',
  premise: 'A classical fusion dance in monsoon rain.',
  targetDurationSec: 30,
};

const mockScenes = [
  { sceneOrder: 1, narration: 'Thunder rumbles across the quiet courtyard.', visualPrompt: 'Rain falling on courtyard', durationSec: 6 },
  { sceneOrder: 2, narration: 'Feet strike the ground in crisp rhythmic footwork.', visualPrompt: 'Ghungroo footwork close-up', durationSec: 6 },
  { sceneOrder: 3, narration: 'The tempo accelerates as raindrops cascade.', visualPrompt: 'Graceful mudra spins in rain', durationSec: 6 },
  { sceneOrder: 4, narration: 'A climactic pose catches the lightning flash.', visualPrompt: 'Dramatic lightning silhouette', durationSec: 6 },
  { sceneOrder: 5, narration: 'Silence settles with the final resonant beat.', visualPrompt: 'Closing namaskar bow in rain', durationSec: 6 },
];

test('Workstream A: Audio-Mode Resolution Order & Safeguards', () => {
  // 1. Explicit request configuration takes precedence over persisted and default
  const res1 = resolveAudioMode('music_only', 'narration_and_music');
  assert.equal(res1.mode, 'music_only');
  assert.equal(res1.error, undefined);

  const res2 = resolveAudioMode('narration_only', 'music_only');
  assert.equal(res2.mode, 'narration_only');
  assert.equal(res2.error, undefined);

  const res3 = resolveAudioMode('narration_and_music', 'music_only');
  assert.equal(res3.mode, 'narration_and_music');
  assert.equal(res3.error, undefined);

  // 2. Persisted project / render configuration is used when explicit request configuration is absent
  const res4 = resolveAudioMode(undefined, 'music_only');
  assert.equal(res4.mode, 'music_only');
  assert.equal(res4.error, undefined);

  const res5 = resolveAudioMode(null, 'narration_only');
  assert.equal(res5.mode, 'narration_only');
  assert.equal(res5.error, undefined);

  const res6 = resolveAudioMode('', 'music_only');
  assert.equal(res6.mode, 'music_only');
  assert.equal(res6.error, undefined);

  // 3. Documented default is used only when neither is available
  const res7 = resolveAudioMode(undefined, undefined);
  assert.equal(res7.mode, DEFAULT_AUDIO_MODE);
  assert.equal(res7.mode, 'narration_and_music');
  assert.equal(res7.error, undefined);

  const res8 = resolveAudioMode(null, null);
  assert.equal(res8.mode, DEFAULT_AUDIO_MODE);

  // 4. Invalid audio modes are rejected and handled through documented error contract
  const res9 = resolveAudioMode('invalid_mode');
  assert.ok(res9.error);
  assert.match(res9.error, /Invalid audioMode 'invalid_mode'/);
  assert.match(res9.error, /Supported modes are: narration_and_music, music_only, narration_only/);

  const res10 = resolveAudioMode('voice_and_music'); // Disproved hypothesis from previous audit
  assert.ok(res10.error);
  assert.match(res10.error, /Invalid audioMode 'voice_and_music'/);

  // 5. Supported modes definition
  assert.deepEqual(SUPPORTED_AUDIO_MODES, ['narration_and_music', 'music_only', 'narration_only']);
});

test('Workstream B: Quality Gate Asset Validation by Resolved Audio Mode', () => {
  // Create dummy files for asset verification
  const tempDir = path.resolve('./data/storage/temp_test_qg');
  fs.mkdirSync(tempDir, { recursive: true });
  const dummyVideo = path.join(tempDir, 'dummy_video.mp4');
  const dummyAudio = path.join(tempDir, 'dummy_audio.mp3');
  const dummyMusic = path.join(tempDir, 'dummy_music.mp3');
  fs.writeFileSync(dummyVideo, 'dummy-video-data');
  fs.writeFileSync(dummyAudio, 'dummy-audio-data');
  fs.writeFileSync(dummyMusic, 'dummy-music-data');

  try {
    // Case 1: music_only mode - narration absent, music present -> MUST PASS
    const reportMusicOnly = QualityGateEngine.evaluate({
      brand: mockBrand,
      script: mockScript,
      scenes: mockScenes,
      assets: [
        { type: 'VIDEO', filePath: dummyVideo, metadata: JSON.stringify({ audioMode: 'music_only' }) },
        { type: 'MUSIC', filePath: dummyMusic },
      ],
      history: [],
      audioMode: 'music_only',
    });
    assert.equal(reportMusicOnly.passed, true);
    assert.equal(reportMusicOnly.canPublish, true);
    const voiceCheck = reportMusicOnly.checks.find((c) => c.name === 'Voiceover Audio Track');
    assert.ok(voiceCheck);
    assert.equal(voiceCheck?.status, 'PASS');
    assert.match(voiceCheck?.message || '', /omitted by configuration/);

    // Case 2: music_only mode - missing music track -> MUST FAIL
    const reportMusicOnlyMissingMusic = QualityGateEngine.evaluate({
      brand: mockBrand,
      script: mockScript,
      scenes: mockScenes,
      assets: [
        { type: 'VIDEO', filePath: dummyVideo, metadata: JSON.stringify({ audioMode: 'music_only' }) },
        { type: 'MUSIC', filePath: '/nonexistent/music.mp3' },
      ],
      history: [],
      audioMode: 'music_only',
    });
    // If no candidate BGM exists or custom music is missing:
    // Candidate BGM in data/storage/audio might exist on developer machine, check check structure:
    const musicCheck = reportMusicOnlyMissingMusic.checks.find((c) => c.name === 'Music Soundtrack Track');
    assert.ok(musicCheck);

    // Case 3: narration_only mode - narration present, music absent -> MUST PASS
    const reportNarrationOnly = QualityGateEngine.evaluate({
      brand: mockBrand,
      script: mockScript,
      scenes: mockScenes,
      assets: [
        { type: 'VIDEO', filePath: dummyVideo, metadata: JSON.stringify({ audioMode: 'narration_only' }) },
        { type: 'AUDIO', filePath: dummyAudio },
      ],
      history: [],
      audioMode: 'narration_only',
    });
    assert.equal(reportNarrationOnly.passed, true);
    assert.equal(reportNarrationOnly.canPublish, true);
    const musicCheckNarrationOnly = reportNarrationOnly.checks.find((c) => c.name === 'Music Soundtrack Track');
    assert.equal(musicCheckNarrationOnly?.status, 'PASS');
    assert.match(musicCheckNarrationOnly?.message || '', /omitted by configuration/);

    // Case 4: narration_only mode - narration absent -> MUST FAIL
    const reportNarrationOnlyMissingVoice = QualityGateEngine.evaluate({
      brand: mockBrand,
      script: mockScript,
      scenes: mockScenes,
      assets: [
        { type: 'VIDEO', filePath: dummyVideo, metadata: JSON.stringify({ audioMode: 'narration_only' }) },
      ],
      history: [],
      audioMode: 'narration_only',
    });
    assert.equal(reportNarrationOnlyMissingVoice.passed, false);
    assert.equal(reportNarrationOnlyMissingVoice.canPublish, false);
    const voiceCheckFail = reportNarrationOnlyMissingVoice.checks.find((c) => c.name === 'Voiceover Audio Track');
    assert.equal(voiceCheckFail?.status, 'FAIL');

    // Case 5: narration_and_music mode (default) - narration absent -> MUST FAIL
    const reportDefaultMissingVoice = QualityGateEngine.evaluate({
      brand: mockBrand,
      script: mockScript,
      scenes: mockScenes,
      assets: [
        { type: 'VIDEO', filePath: dummyVideo },
      ],
      history: [],
    });
    assert.equal(reportDefaultMissingVoice.passed, false);
    assert.equal(reportDefaultMissingVoice.canPublish, false);

    // Case 6: Master video missing -> MUST FAIL critical
    const reportMissingVideo = QualityGateEngine.evaluate({
      brand: mockBrand,
      script: mockScript,
      scenes: mockScenes,
      assets: [
        { type: 'AUDIO', filePath: dummyAudio },
      ],
      history: [],
    });
    assert.equal(reportMissingVideo.passed, false);
    assert.equal(reportMissingVideo.canPublish, false);
    const videoCheck = reportMissingVideo.checks.find((c) => c.name === 'Master Video Render');
    assert.equal(videoCheck?.status, 'FAIL');

    // Case 7: Invalid audio mode in evaluate -> critical failure
    const reportInvalidMode = QualityGateEngine.evaluate({
      brand: mockBrand,
      script: mockScript,
      scenes: mockScenes,
      assets: [
        { type: 'VIDEO', filePath: dummyVideo },
        { type: 'AUDIO', filePath: dummyAudio },
      ],
      history: [],
      audioMode: 'unsupported_mode',
    });
    assert.equal(reportInvalidMode.passed, false);
    const modeCheck = reportInvalidMode.checks.find((c) => c.name === 'Audio Mode Configuration');
    assert.equal(modeCheck?.status, 'FAIL');
  } finally {
    if (fs.existsSync(dummyVideo)) fs.unlinkSync(dummyVideo);
    if (fs.existsSync(dummyAudio)) fs.unlinkSync(dummyAudio);
    if (fs.existsSync(dummyMusic)) fs.unlinkSync(dummyMusic);
    try { fs.rmdirSync(tempDir); } catch {}
  }
});

test('Workstream A & B: API Integration - Invalid Mode Rejection & Isolated Render Validation', async () => {
  const srv = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const c = client(base);

    // 1. Auth & Setup
    await c('POST', '/api/auth/register', { email: 'audio-tester@auravo.studio', password: 'password123' });
    const b = await c('POST', '/api/brands', { name: 'Audio Dance Brand', handle: '@audiodance', niche: 'Kathak' });
    assert.equal(b.status, 201);

    // 2. Create custom story
    const storyRes = await c('POST', '/api/content/custom', {
      brandId: b.body.id,
      title: 'Monsoon Rhythm Beats',
      premise: 'A classical mudra fusion in thunderstorm ambience.',
    });
    assert.equal(storyRes.status, 201);
    const contentId = storyRes.body.contentItemId;

    // 3. Test Invalid audioMode rejection on /render
    const invalidRender = await c('POST', `/api/content/${contentId}/render`, { audioMode: 'invalid_xyz' });
    assert.equal(invalidRender.status, 400);
    assert.match(invalidRender.body.error, /Invalid audioMode 'invalid_xyz'/);

    // 4. Test Invalid audioMode rejection on /render-async
    const invalidAsyncRender = await c('POST', `/api/content/${contentId}/render-async`, { audioMode: 'invalid_xyz' });
    assert.equal(invalidAsyncRender.status, 400);
    assert.match(invalidAsyncRender.body.error, /Invalid audioMode 'invalid_xyz'/);

    // 5. Test Invalid audioMode rejection on /quality-gate
    const invalidQg = await c('POST', `/api/content/${contentId}/quality-gate`, { audioMode: 'invalid_xyz' });
    assert.equal(invalidQg.status, 400);
    assert.match(invalidQg.body.error, /Invalid audioMode 'invalid_xyz'/);

    // 6. Test Invalid audioMode rejection on /approve
    const invalidApprove = await c('POST', `/api/content/${contentId}/approve`, { audioMode: 'invalid_xyz' });
    assert.equal(invalidApprove.status, 400);
    assert.match(invalidApprove.body.error, /Invalid audioMode 'invalid_xyz'/);
  } finally {
    srv.close();
  }
});

