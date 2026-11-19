import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDb } from '../server/db.js';
import { VideoStudioProvider, computeFileSha256, getFfmpegPath, getFfprobePath } from '../server/providers/video_studio.js';

const execFileAsync = promisify(execFile);

async function runDemo() {
  console.log('=== AURAVO STUDIO — PRODUCT SPRINT 3 DEMONSTRATION ===');
  const dbPath = path.resolve('./data/studio.db');
  const db = openDb(dbPath);

  // 1. Seed User #1 if not exists
  let user = db.prepare("SELECT id FROM users WHERE email='creator@auravo.studio'").get() as any;
  if (!user) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = salt + ':' + crypto.scryptSync('Password123!', salt, 64).toString('hex');
    const uInfo = db.prepare("INSERT INTO users (email, passwordHash) VALUES ('creator@auravo.studio', ?)").run(hash);
    user = { id: Number(uInfo.lastInsertRowid) };
    console.log(`[Seed] Created User #1 (creator@auravo.studio), ID: ${user.id}`);
  } else {
    console.log(`[Seed] User #1 already exists, ID: ${user.id}`);
  }

  // 2. Seed Brand #1 if not exists
  let brand = db.prepare('SELECT id FROM brands WHERE ownerId=?').get(user.id) as any;
  if (!brand) {
    const bInfo = db.prepare("INSERT INTO brands (ownerId, name, handle, description) VALUES (?, 'Auravo Entertainment', '@auravo', 'AI Character Virtual Studio')").run(user.id);
    brand = { id: Number(bInfo.lastInsertRowid) };
    console.log(`[Seed] Created Brand #1, ID: ${brand.id}`);
  } else {
    console.log(`[Seed] Brand #1 already exists, ID: ${brand.id}`);
  }

  // 3. Seed Character Aria Dev if not exists
  let character = db.prepare("SELECT id, name FROM characters WHERE name='Aria Dev' AND ownerId=?").get(user.id) as any;
  const portraitRelPath = '/api/media/images/char_aria_dev_1794907355086.png';
  if (!character) {
    const cInfo = db.prepare(`
      INSERT INTO characters (
        ownerId, brandId, name, description, age, personality, appearance, clothingStyle,
        visualPrompt, voiceStyle, referenceImage, generationModel
      ) VALUES (?, ?, 'Aria Dev', 'Virtual classical and modern AI performer', 24, 'Elegant and poised', 'Regal posture, expressive eyes, ornate crown', 'Emerald silk blouse with gold accents', 'Regal character portrait with royal stage lighting', 'Samantha', ?, 'AURAVO_LOCAL_VECTOR_V1')
    `).run(user.id, brand.id, portraitRelPath);
    character = { id: Number(cInfo.lastInsertRowid), name: 'Aria Dev' };
    console.log(`[Seed] Created Character Aria Dev, ID: ${character.id}`);
  } else {
    console.log(`[Seed] Character Aria Dev exists, ID: ${character.id}`);
  }

  // 4. Seed Saved Motion Studio Animation record for demo_aria_wave_sprint2_1.mp4 if not exists
  const animVideoRel = '/api/media/videos/demo_aria_wave_sprint2_1.mp4';
  const animDiskPath = path.resolve('./data/storage/videos/demo_aria_wave_sprint2_1.mp4');
  if (!fs.existsSync(animDiskPath)) {
    throw new Error(`Prerequisite animation file missing: ${animDiskPath}`);
  }
  const animSha = computeFileSha256(animDiskPath);
  const animStat = fs.statSync(animDiskPath);

  let animation = db.prepare('SELECT * FROM character_animations WHERE characterId=? AND preset=?').get(character.id, 'wave') as any;
  if (!animation) {
    const aInfo = db.prepare(`
      INSERT INTO character_animations (
        ownerId, brandId, characterId, title, preset, description,
        durationSec, fps, width, height, videoUrl, thumbnailUrl,
        sha256, fileSize, modelUsed, metadata
      ) VALUES (?, ?, ?, 'Aria Dev - Stage Wave Animation', 'wave', 'Articulated harmonic wave movement', 2.0, 30, 768, 1024, ?, '', ?, ?, 'AURAVO_LOCAL_KINEMATIC_PYTORCH_V1', '{}')
    `).run(user.id, brand.id, character.id, animVideoRel, animSha, animStat.size);
    animation = db.prepare('SELECT * FROM character_animations WHERE id=?').get(aInfo.lastInsertRowid) as any;
    console.log(`[Seed] Created Animation Record #ID: ${animation.id}`);
  } else {
    console.log(`[Seed] Animation Record exists, ID: ${animation.id}`);
  }

  // 5. Execute Video Studio Composition Workflow
  const videoStudio = new VideoStudioProvider(db);
  const outPath = path.resolve('./data/storage/videos/demo_aria_video_sprint3.mp4');

  console.log('[Compose] Starting video composition (9:16 vertical, blurred backdrop, narration, ambient BGM)...');
  const composed = await videoStudio.composeVideo({
    characterId: character.id,
    animationId: animation.id,
    title: 'Aria Dev: Royal Stage Performance',
    aspectRatio: '9:16',
    canvasStyle: 'blurred_backdrop',
    titleOverlay: 'Aria Dev: Royal Stage Wave',
    subtitleText: 'Aria greets the audience with poise and grace.',
    characterBadge: true,
    narrationText: 'Welcome to Auravo Studio. Aria is performing her royal stage wave.',
    narrationVoice: 'Samantha',
    bgmTrack: 'auravo_ambient_lounge',
    voiceVolume: 1.25,
    bgmVolume: 0.28,
    outputVideoPath: outPath,
  });

  console.log('[Compose] Composition complete!');
  console.log('Result:', {
    videoPath: composed.videoPath,
    resolution: composed.resolution,
    durationSec: composed.durationSec,
    fps: composed.fps,
    sha256: composed.sha256,
    fileSize: `${Math.round(composed.fileSize / 1024)} KB`,
    renderTimeMs: `${composed.renderStats.renderTimeMs}ms`,
  });

  // 6. Generate 8-frame Contact Sheet for forensic visual inspection
  const contactSheetPath = path.resolve('./data/storage/videos/demo_aria_video_contact_sheet_sprint3.png');
  const ffmpegBin = getFfmpegPath();
  await execFileAsync(ffmpegBin, [
    '-y',
    '-i', outPath,
    '-vf', 'fps=4,scale=320:568,tile=4x2',
    '-vframes', '1',
    contactSheetPath,
  ]);
  console.log(`[Contact Sheet] Generated: ${contactSheetPath} (${fs.statSync(contactSheetPath).size} bytes)`);

  // 7. Extract 3 keyframes for forensic inspection (t=0.2s, t=mid, t=end)
  const frame0Path = path.resolve('./data/storage/videos/demo_aria_video_frame_start.png');
  const frameMidPath = path.resolve('./data/storage/videos/demo_aria_video_frame_mid.png');
  const frameEndPath = path.resolve('./data/storage/videos/demo_aria_video_frame_end.png');

  await execFileAsync(ffmpegBin, ['-y', '-ss', '0.2', '-i', outPath, '-vframes', '1', frame0Path]);
  await execFileAsync(ffmpegBin, ['-y', '-ss', String(composed.durationSec / 2), '-i', outPath, '-vframes', '1', frameMidPath]);
  await execFileAsync(ffmpegBin, ['-y', '-ss', String(composed.durationSec - 0.2), '-i', outPath, '-vframes', '1', frameEndPath]);
  console.log('[Frames] Keyframes extracted: start, mid, end');

  // 8. Persist to database character_videos table
  const videoRel = '/api/media/videos/demo_aria_video_sprint3.mp4';
  const thumbRel = '/api/media/videos/demo_aria_video_frame_mid.png';
  let videoRow = db.prepare('SELECT id FROM character_videos WHERE sha256=? AND ownerId=?').get(composed.sha256, user.id) as any;
  if (!videoRow) {
    const vInfo = db.prepare(`
      INSERT INTO character_videos (
        ownerId, brandId, characterId, animationId, title, description,
        aspectRatio, resolution, width, height, durationSec, fps,
        videoUrl, thumbnailUrl, sha256, fileSize,
        compositionConfig, audioConfig, subtitleConfig
      ) VALUES (?, ?, ?, ?, 'Aria Dev: Royal Stage Performance', 'Sprint 3 end-to-end demonstration composed video', '9:16', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      brand.id,
      character.id,
      animation.id,
      composed.resolution,
      composed.width,
      composed.height,
      composed.durationSec,
      composed.fps,
      videoRel,
      thumbRel,
      composed.sha256,
      composed.fileSize,
      JSON.stringify(composed.compositionConfig),
      JSON.stringify(composed.audioConfig),
      JSON.stringify(composed.subtitleConfig)
    );
    videoRow = { id: Number(vInfo.lastInsertRowid) };
    console.log(`[Persistence] Saved composed video to character_videos table with ID #${videoRow.id}`);
  } else {
    console.log(`[Persistence] Composed video already recorded in character_videos table with ID #${videoRow.id}`);
  }

  // 9. Run ffprobe inspection
  const ffprobeBin = getFfprobePath();
  const { stdout: probeOut } = await execFileAsync(ffprobeBin, [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,codec_type,width,height,r_frame_rate,duration,channels',
    '-show_entries', 'format=duration,size,bit_rate',
    '-of', 'json',
    outPath,
  ]);
  console.log('[FFprobe] Stream Analysis:');
  console.log(probeOut);

  console.log('=== SPRINT 3 DEMONSTRATION COMPLETE — PASS ===');
}

runDemo().catch((err) => {
  console.error('Sprint 3 Demo Failed:', err);
  process.exit(1);
});
