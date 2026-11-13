import path from 'node:path';
import fs from 'node:fs';
import { openDb } from '../server/db.js';
import { LivePortraitFaceAnimatorProvider } from '../server/providers/face_animator.js';
import { FFmpegVideoProvider } from '../server/providers/video.js';

async function main() {
  const db = openDb('./data/studio.db');
  const animator = new LivePortraitFaceAnimatorProvider();
  const videoProvider = new FFmpegVideoProvider();

  console.log('Generating real LivePortrait facial expression clip for Beat 1 & 2...');

  const priyaImage = path.resolve('./data/storage/images/priya_portrait.jpg');
  const audioAsset = db.prepare("SELECT filePath FROM assets WHERE contentItemId=1 AND type='AUDIO'").get() as any;
  const audioPath = audioAsset?.filePath || path.resolve('./data/storage/audio/narration_1_1790876144527.mp3');

  const clip1Path = path.resolve('./data/storage/videos/clip_1_1_liveportrait.mp4');
  await animator.animateFace({
    sourceImagePath: priyaImage,
    motionPreset: 'dramatic_intro',
    durationSec: 5,
    outputVideoPath: clip1Path,
  });

  const clip2Path = path.resolve('./data/storage/videos/clip_1_2_liveportrait.mp4');
  await animator.animateFace({
    sourceImagePath: priyaImage,
    motionPreset: 'natural_speaking',
    durationSec: 8,
    outputVideoPath: clip2Path,
  });

  console.log('Updating assets table with LivePortrait clips...');
  db.prepare("UPDATE assets SET filePath=?, provider='LivePortrait' WHERE contentItemId=1 AND id=1").run(clip1Path);
  db.prepare("UPDATE assets SET filePath=?, provider='LivePortrait' WHERE contentItemId=1 AND id=2").run(clip2Path);

  // Now re-render master video using these real animated clips!
  const scenes = [
    { videoClipPath: clip1Path, durationSec: 5, narration: 'When the first heavy monsoon raindrop strikes the courtyard floor, the temple bells begin to echo.' },
    { videoClipPath: clip2Path, durationSec: 8, narration: 'Every step was counted in the shadows. But tonight, the rhythmic cadence ignites the night.' },
    { imagePath: priyaImage, durationSec: 10, narration: 'As the rhythm accelerates, classical grace explodes into contemporary high-energy power.' },
    { imagePath: priyaImage, durationSec: 8, narration: 'In that single heartbeat between the thunder and the beat, the mystery was unveiled.' },
    { imagePath: priyaImage, durationSec: 6, narration: 'Did you catch the footwork transition at beat three? Replay to see it, and follow Auravo for tomorrow night’s solo.' },
  ];

  const srtFile = path.resolve('./data/storage/subtitles/subtitles_1.srt');
  const masterOut = path.resolve('./data/storage/videos/short_1_master.mp4');

  console.log('Re-rendering master 9:16 vertical video with LivePortrait animation...');
  await videoProvider.renderShort({
    scenes,
    audioTrackPath: audioPath,
    subtitlesSrtPath: srtFile,
    outputPath: masterOut,
    title: 'Monsoon Rhythm: The Peacock Gateway',
  });

  console.log('✅ Re-rendered master video with LivePortrait animation:', masterOut);
}

main().catch(console.error);
