import path from 'node:path';
import { LivePortraitFaceAnimatorProvider } from '../server/providers/face_animator.js';

async function main() {
  const animator = new LivePortraitFaceAnimatorProvider();
  const sourceImage = path.resolve('./data/storage/images/priya_portrait.jpg');
  const outputFile = path.resolve('./data/storage/videos/priya_animated_face_demo.mp4');

  console.log('Animating Priya with LivePortrait facial expression engine...');
  const res = await animator.animateFace({
    sourceImagePath: sourceImage,
    motionPreset: 'natural_speaking',
    durationSec: 4,
    outputVideoPath: outputFile,
  });

  console.log('✅ Generated animated face video:', res);
}

main().catch(console.error);
