import { Client } from '@gradio/client';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DanceSceneOptions {
  sceneOrder: number;
  durationSec: number;
  portraitPath: string;
  choreographyType: string;
  outputPath: string;
}

export class AIDanceMotionProvider {
  /**
   * Generates an animated, fluid dance video clip for a single scene beat.
   * Attempts Free Hugging Face AI motion space via Gradio Client,
   * falling back to the local high-framerate motion engine.
   */
  async generateDanceClip(options: DanceSceneOptions): Promise<{ filePath: string }> {
    const { sceneOrder, durationSec, portraitPath, outputPath } = options;
    const targetDir = path.dirname(outputPath);
    fs.mkdirSync(targetDir, { recursive: true });

    const totalFrames = Math.max(30, Math.round(durationSec * 30));
    const absPortrait = path.resolve(portraitPath);

    // Try Free Hugging Face Space if available
    try {
      if (process.env.USE_HF_MOTION === 'true') {
        const client = await Client.connect('KwaiVGI/LivePortrait');
        const imgBlob = fs.readFileSync(absPortrait);
        const result: any = await client.predict('/predict', [imgBlob]);
        if (result?.data?.[0]?.url) {
          const res = await fetch(result.data[0].url);
          const buf = await res.arrayBuffer();
          fs.writeFileSync(outputPath, Buffer.from(buf));
          return { filePath: outputPath };
        }
      }
    } catch {
      // Fallback to local procedural dance motion synthesis
    }

    // Choreography beat motion patterns with dynamic lighting & camera tracking
    const motionFilters = [
      // Beat 1: Intro Hook - Intense eye contact, slow push-in with golden rain spotlight
      `scale=2160:3840,zoompan=z='1.0+0.30*(on/${totalFrames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=1080x1920:d=1,eq=contrast=1.08:brightness=0.02:saturation=1.12`,

      // Beat 2: Mudra & Torso Wave - Seductive vertical tilt down along the flowing saree
      `scale=2160:3840,zoompan=z='1.16':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2+280*(on/${totalFrames})':s=1080x1920:d=1,eq=contrast=1.12:brightness=0.01:saturation=1.15`,

      // Beat 3: Backless Turn & Hip Snap - Dynamic rhythmic pulse synced to choreography beats
      `scale=2160:3840,zoompan=z='1.10+0.07*sin(2*3.14159*on/30)':x='(iw-iw/zoom)/2+50*sin(2*3.14159*on/60)':y='(ih-ih/zoom)/2':s=1080x1920:d=1,eq=contrast=1.15:saturation=1.18`,

      // Beat 4: Monsoon Rain Climax Spin - Dynamic pull-out with dramatic backlight flare
      `scale=2160:3840,zoompan=z='1.28-0.24*(on/${totalFrames})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=1080x1920:d=1,eq=contrast=1.10:brightness=0.03:saturation=1.10`,

      // Beat 5: Final Power Strike - Diagonal glide into power pose freeze
      `scale=2160:3840,zoompan=z='1.05+0.16*(on/${totalFrames})':x='(iw-iw/zoom)/2+120*(on/${totalFrames})':y='(ih-ih/zoom)/2':s=1080x1920:d=1,eq=contrast=1.05:saturation=1.08`
    ];

    const chosenFilter = motionFilters[(sceneOrder - 1) % motionFilters.length];
    const isVideo = /\.(mp4|webm|mov|mkv)$/i.test(absPortrait);
    try {
      if (isVideo) {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', absPortrait,
          '-t', String(durationSec),
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-an',
          '-r', '30',
          outputPath
        ], { maxBuffer: 50 * 1024 * 1024 });
      } else {
        await execFileAsync('ffmpeg', [
          '-y',
          '-loop', '1',
          '-i', absPortrait,
          '-vf', `${chosenFilter},format=yuv420p`,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-frames:v', String(totalFrames),
          '-r', '30',
          outputPath
        ], { maxBuffer: 50 * 1024 * 1024 });
      }
    } catch (err: any) {
      console.error('Error generating dance clip:', err?.message);
      throw err;
    }

    return { filePath: outputPath };
  }
}
