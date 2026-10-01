import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { VideoProvider } from './types.js';

const execFileAsync = promisify(execFile);

export function generateSrtContent(scenes: Array<{ narration: string; durationSec: number }>): string {
  let currentTime = 0;
  let srt = '';

  const formatTimestamp = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = Math.floor(totalSec % 60);
    const millis = Math.floor((totalSec % 1) * 1000);

    const pad = (n: number, z = 2) => String(n).padStart(z, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
  };

  scenes.forEach((scene, index) => {
    const startTime = currentTime;
    const endTime = currentTime + scene.durationSec;
    currentTime = endTime;

    srt += `${index + 1}\n`;
    srt += `${formatTimestamp(startTime)} --> ${formatTimestamp(endTime)}\n`;
    srt += `${scene.narration.trim()}\n\n`;
  });

  return srt;
}

export class FFmpegVideoProvider implements VideoProvider {
  async renderShort(options: {
    scenes: Array<{
      imagePath?: string;
      videoClipPath?: string;
      narration: string;
      durationSec: number;
    }>;
    audioTrackPath: string;
    subtitlesSrtPath: string;
    outputPath: string;
    title?: string;
  }): Promise<{ filePath: string; durationSec: number }> {
    const targetDir = path.resolve('./data/storage/videos');
    fs.mkdirSync(targetDir, { recursive: true });

    const finalOut = options.outputPath || path.join(targetDir, `short_${Date.now()}.mp4`);
    const totalDuration = options.scenes.reduce((acc, s) => acc + s.durationSec, 0);

    const tempClips: string[] = [];
    const concatListPath = path.join(targetDir, `concat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);

    // Motion presets with guaranteed continuous on-frame camera movement
    const getMotionFilter = (idx: number, frames: number): string => {
      const f = Math.max(30, frames);
      const motionPatterns = [
        // Scene 1: Dramatic Push-In / Hook Zoom
        `scale=2160:3840,zoompan=z='1.0+0.30*(on/${f})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=1080x1920:d=1`,
        // Scene 2: Seductive Slow Vertical Tilt-Down / Saree & Bralette Tracking
        `scale=2160:3840,zoompan=z='1.15':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2+250*(on/${f})':s=1080x1920:d=1`,
        // Scene 3: Dynamic Choreography Rhythmic Pulse & Drift
        `scale=2160:3840,zoompan=z='1.08+0.08*sin(2*3.14159*on/30)':x='(iw-iw/zoom)/2+60*sin(2*3.14159*on/60)':y='(ih-ih/zoom)/2':s=1080x1920:d=1`,
        // Scene 4: Climax Pull-out Reveal into Stage Backlight Halo
        `scale=2160:3840,zoompan=z='1.25-0.20*(on/${f})':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':s=1080x1920:d=1`,
        // Scene 5: Cinematic Diagonal Glide & Soft Outro
        `scale=2160:3840,zoompan=z='1.05+0.18*(on/${f})':x='(iw-iw/zoom)/2+100*(on/${f})':y='(ih-ih/zoom)/2':s=1080x1920:d=1`
      ];
      return motionPatterns[idx % motionPatterns.length];
    };

    try {
      // 1. Render animated motion clip or moving video clip for each scene
      for (let i = 0; i < options.scenes.length; i++) {
        const sc = options.scenes[i];
        const clipFile = path.join(targetDir, `temp_motion_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}.mp4`);

        if (sc.videoClipPath && fs.existsSync(sc.videoClipPath)) {
          // Process moving dance video clip (with seamless looping to match full beat duration)
          await execFileAsync('ffmpeg', [
            '-y',
            '-stream_loop', '-1',
            '-i', path.resolve(sc.videoClipPath),
            '-t', String(sc.durationSec),
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-an',
            '-r', '30',
            clipFile
          ], { maxBuffer: 50 * 1024 * 1024 });
        } else if (sc.imagePath && fs.existsSync(sc.imagePath)) {
          const frames = Math.max(30, Math.round(sc.durationSec * 30));
          const motionVf = `${getMotionFilter(i, frames)},format=yuv420p`;

          await execFileAsync('ffmpeg', [
            '-y',
            '-loop', '1',
            '-i', path.resolve(sc.imagePath),
            '-vf', motionVf,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-frames:v', String(frames),
            '-r', '30',
            clipFile
          ], { maxBuffer: 50 * 1024 * 1024 });
        }

        tempClips.push(clipFile);
      }

      // 2. Build concat list for animated clips
      let concatContent = '';
      for (const clip of tempClips) {
        concatContent += `file '${path.resolve(clip).replace(/'/g, "'\\''")}'\n`;
      }
      fs.writeFileSync(concatListPath, concatContent, 'utf8');

      // 3. Assemble final video with audio track + rhythmic background dance beat
      const hasAudio = fs.existsSync(options.audioTrackPath) && fs.statSync(options.audioTrackPath).size > 0;
      const bgmPath = path.resolve('./data/storage/audio/bollywood_monsoon_beat.mp3');
      const hasBgm = fs.existsSync(bgmPath);

      const ffmpegArgs: string[] = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
      ];

      if (hasAudio && hasBgm) {
        ffmpegArgs.push('-i', path.resolve(options.audioTrackPath));
        ffmpegArgs.push('-stream_loop', '-1', '-i', bgmPath);
        ffmpegArgs.push(
          '-filter_complex',
          '[1:a]volume=1.25[voice];[2:a]volume=0.32[bgm];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]',
          '-map', '0:v',
          '-map', '[aout]',
          '-c:a', 'aac',
          '-b:a', '192k'
        );
      } else if (hasAudio) {
        ffmpegArgs.push('-i', path.resolve(options.audioTrackPath));
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
      }

      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-profile:v', 'main',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-g', '30',
        '-movflags', '+faststart',
        '-t', String(totalDuration),
        finalOut
      );

      await execFileAsync('ffmpeg', ffmpegArgs, { maxBuffer: 50 * 1024 * 1024 });
    } catch (err: any) {
      console.error('FFmpeg render error:', err?.stderr || err?.message);
      throw new Error(`Video rendering failed: ${err?.message || 'FFmpeg error'}`);
    } finally {
      try { fs.unlinkSync(concatListPath); } catch {}
      for (const c of tempClips) {
        try { fs.unlinkSync(c); } catch {}
      }
    }

    return { filePath: finalOut, durationSec: totalDuration };
  }
}
