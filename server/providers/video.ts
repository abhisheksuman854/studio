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
    musicTrackPath?: string;
    audioMode?: 'music_only' | 'narration_and_music' | 'narration_only';
  }): Promise<{ filePath: string; durationSec: number }> {
    const targetDir = path.resolve('./data/storage/videos');
    fs.mkdirSync(targetDir, { recursive: true });

    const finalOut = options.outputPath || path.join(targetDir, `short_${Date.now()}.mp4`);
    const totalDuration = options.scenes.reduce((acc, s) => acc + s.durationSec, 0);

    const tempClips: string[] = [];
    const concatListPath = path.join(targetDir, `concat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);

    // Motion presets with guaranteed 9:16 aspect-ratio preservation and buttery-smooth continuous camera movement
    const getMotionFilter = (idx: number, durationSec: number): string => {
      const dur = Math.max(1, durationSec);
      const motionPatterns = [
        // Scene 1: Smooth cinematic push-in (zoom 1.0 -> 1.14) anchored on eye-line
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=eval=frame:w='1080*(1+0.14*t/${dur})':h='1920*(1+0.14*t/${dur})':flags=bicubic,crop=1080:1920:(in_w-1080)/2:(in_h-1920)*0.22,fps=30`,
        // Scene 2: Gentle vertical pedestal tracking downwards (reveals dance attire & mudras)
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=1200:2133,crop=1080:1920:(in_w-1080)/2:'(in_h-1920)*(0.15+0.15*t/${dur})',fps=30`,
        // Scene 3: Smooth continuous lateral camera glide across stage
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=1200:2133,crop=1080:1920:'(in_w-1080)*(0.25+0.50*t/${dur})':(in_h-1920)*0.22,fps=30`,
        // Scene 4: Climax Pull-Out - Dramatic smooth pull-out revealing the full stage
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=eval=frame:w='1080*(1.15-0.15*t/${dur})':h='1920*(1.15-0.15*t/${dur})':flags=bicubic,crop=1080:1920:(in_w-1080)/2:(in_h-1920)*0.24,fps=30`,
        // Scene 5: Final Graceful Bow - Smooth diagonal glide with gentle ease-in
        `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,scale=1220:2168,crop=1080:1920:'(in_w-1080)*(0.60-0.25*t/${dur})':'(in_h-1920)*(0.20+0.10*t/${dur})',fps=30`
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
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(in_w-1080)/2:(in_h-1920)/2,fps=30,format=yuv420p',
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-an',
            '-r', '30',
            clipFile
          ], { maxBuffer: 50 * 1024 * 1024 });
        } else if (sc.imagePath && fs.existsSync(sc.imagePath)) {
          const motionVf = `${getMotionFilter(i, sc.durationSec)},format=yuv420p`;

          await execFileAsync('ffmpeg', [
            '-y',
            '-loop', '1',
            '-t', String(sc.durationSec),
            '-i', path.resolve(sc.imagePath),
            '-vf', motionVf,
            '-c:v', 'libx264',
            '-preset', 'fast',
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
      const hasAudio = options.audioTrackPath && fs.existsSync(options.audioTrackPath) && fs.statSync(options.audioTrackPath).size > 0;
      const audioDir = path.resolve('./data/storage/audio');
      const candidateBgm = (options.musicTrackPath && fs.existsSync(options.musicTrackPath))
        ? options.musicTrackPath
        : [
            path.join(audioDir, 'bollywood_monsoon_beat.mp3'),
            path.join(audioDir, 'hindi_music.mp3'),
            path.join(audioDir, 'sensual_bgm.mp3'),
            path.join(audioDir, 'bgm.mp3'),
          ].find((p) => fs.existsSync(p));
      const hasBgm = !!candidateBgm;
      const isPureMusicMode = options.audioMode === 'music_only' || (!hasAudio && hasBgm);

      const ffmpegArgs: string[] = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
      ];

      if (isPureMusicMode && candidateBgm) {
        // Pure Song Music Mode: Full fidelity Hindi music track, zero narration voiceover
        ffmpegArgs.push('-stream_loop', '-1', '-i', candidateBgm);
        ffmpegArgs.push(
          '-map', '0:v',
          '-map', '1:a',
          '-c:a', 'aac',
          '-b:a', '256k',
          '-af', 'volume=1.0',
          '-shortest'
        );
      } else if (hasAudio && hasBgm && candidateBgm) {
        ffmpegArgs.push('-i', path.resolve(options.audioTrackPath));
        ffmpegArgs.push('-stream_loop', '-1', '-i', candidateBgm);
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
