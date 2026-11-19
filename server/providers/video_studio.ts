import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DB } from '../db.js';
import { LocalTTSProvider } from './tts.js';

const execFileAsync = promisify(execFile);

export type AspectRatioType = '9:16' | '16:9' | '1:1';
export type CanvasStyleType = 'stage_matte' | 'blurred_backdrop' | 'cinematic_letterbox' | 'full_bleed';

export interface AspectRatioPreset {
  id: AspectRatioType;
  label: string;
  width: number;
  height: number;
  description: string;
}

export const ASPECT_RATIO_PRESETS: readonly AspectRatioPreset[] = [
  {
    id: '9:16',
    label: '9:16 Vertical',
    width: 1080,
    height: 1920,
    description: 'Optimized for TikTok, Instagram Reels, and YouTube Shorts',
  },
  {
    id: '16:9',
    label: '16:9 Landscape',
    width: 1920,
    height: 1080,
    description: 'Optimized for YouTube, TV screens, and desktop displays',
  },
  {
    id: '1:1',
    label: '1:1 Square',
    width: 1080,
    height: 1080,
    description: 'Optimized for Instagram feeds and social carousels',
  },
] as const;

export const CANVAS_STYLES: readonly { id: CanvasStyleType; label: string; description: string }[] = [
  {
    id: 'stage_matte',
    label: 'Stage Matte (Slate)',
    description: 'Deep midnight slate studio borders preserving exact character aspect ratio',
  },
  {
    id: 'blurred_backdrop',
    label: 'Blurred Backdrop',
    description: 'Modern ambient aesthetic with blurred character background behind focused center stage',
  },
  {
    id: 'cinematic_letterbox',
    label: 'Cinematic Letterbox',
    description: 'Classic matte black cinematic bars with centered performance',
  },
  {
    id: 'full_bleed',
    label: 'Full Bleed (Cropped)',
    description: 'Completely fills the canvas without letterboxing by cropping outer edges',
  },
] as const;

export interface VideoCompositionOptions {
  characterId: number;
  animationId: number;
  title: string;
  description?: string;
  aspectRatio: AspectRatioType;
  canvasStyle?: CanvasStyleType;
  titleOverlay?: string;
  subtitleText?: string;
  characterBadge?: boolean;
  narrationText?: string;
  narrationVoice?: string;
  bgmTrack?: string;
  voiceVolume?: number;
  bgmVolume?: number;
  outputVideoPath?: string;
  testMock?: boolean;
}

export interface VideoProbeMetadata {
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  videoCodec: string;
  hasAudio: boolean;
  audioCodec?: string;
  audioChannels?: number;
  fileSizeBytes: number;
  sha256: string;
}

export interface ComposedVideoResult {
  videoPath: string;
  videoUrl: string;
  thumbnailUrl: string;
  contactSheetUrl?: string;
  width: number;
  height: number;
  aspectRatio: AspectRatioType;
  resolution: string;
  durationSec: number;
  fps: number;
  sha256: string;
  fileSize: number;
  compositionConfig: Record<string, any>;
  audioConfig: Record<string, any>;
  subtitleConfig: Record<string, any>;
  renderStats: {
    renderTimeMs: number;
    hasAudio: boolean;
    audioChannels: number;
    canvasStyle: CanvasStyleType;
  };
}

export function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function getFfmpegPath(): string {
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', 'ffmpeg'];
  for (const c of candidates) {
    if (c === 'ffmpeg') return c;
    if (fs.existsSync(c)) return c;
  }
  return 'ffmpeg';
}

export function getFfprobePath(): string {
  const candidates = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe', 'ffprobe'];
  for (const c of candidates) {
    if (c === 'ffprobe') return c;
    if (fs.existsSync(c)) return c;
  }
  return 'ffprobe';
}

export function getPythonPath(): string {
  const home = process.env.HOME || '';
  const candidates = [
    path.join(home, '.pyenv/versions/3.10.6/bin/python3'),
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
  ];
  for (const c of candidates) {
    if (c === 'python3') return c;
    if (fs.existsSync(c)) return c;
  }
  return 'python3';
}

export async function validateComposedVideo(
  videoPath: string,
  expected: {
    width?: number;
    height?: number;
    minDuration?: number;
    expectAudio?: boolean;
  } = {}
): Promise<VideoProbeMetadata> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`COMPOSED_VIDEO_MISSING: Output video file not found on disk at "${videoPath}"`);
  }
  const stat = fs.statSync(videoPath);
  if (stat.size < 1000) {
    throw new Error(`COMPOSED_VIDEO_EMPTY: Video output file size too small (${stat.size} bytes)`);
  }

  const ffprobeBin = getFfprobePath();
  let probeRaw: string;
  try {
    const { stdout } = await execFileAsync(
      ffprobeBin,
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_name,codec_type,width,height,r_frame_rate,duration,channels',
        '-show_entries', 'format=duration,size',
        '-of', 'json',
        videoPath,
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    probeRaw = stdout;
  } catch (err: any) {
    throw new Error(`COMPOSED_VIDEO_PROBE_FAILED: ffprobe inspection failed: ${err.message}`);
  }

  const parsed = JSON.parse(probeRaw);
  const streams = parsed.streams || [];
  const videoStream = streams.find((s: any) => s.codec_type === 'video');
  if (!videoStream) {
    throw new Error('COMPOSED_VIDEO_NO_VIDEO_STREAM: Output contains no video stream');
  }

  const audioStream = streams.find((s: any) => s.codec_type === 'audio');
  const durStr = parsed.format?.duration || videoStream.duration;
  const durationSec = parseFloat(durStr || '0');
  const width = videoStream.width || 0;
  const height = videoStream.height || 0;

  // Compute FPS
  let fps = 30;
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den && den > 0) fps = Math.round(num / den);
  }

  if (expected.width && expected.width !== width) {
    throw new Error(`COMPOSED_VIDEO_WIDTH_MISMATCH: Expected width ${expected.width}, got ${width}`);
  }
  if (expected.height && expected.height !== height) {
    throw new Error(`COMPOSED_VIDEO_HEIGHT_MISMATCH: Expected height ${expected.height}, got ${height}`);
  }
  if (expected.minDuration && durationSec < expected.minDuration - 0.2) {
    throw new Error(`COMPOSED_VIDEO_DURATION_TOO_SHORT: Expected duration >= ${expected.minDuration}s, got ${durationSec}s`);
  }
  if (expected.expectAudio && !audioStream) {
    throw new Error('COMPOSED_VIDEO_AUDIO_MISSING: Audio stream was requested but is missing from output container');
  }

  const sha256 = computeFileSha256(videoPath);

  return {
    width,
    height,
    durationSec,
    fps,
    videoCodec: videoStream.codec_name || 'h264',
    hasAudio: !!audioStream,
    audioCodec: audioStream?.codec_name,
    audioChannels: audioStream?.channels,
    fileSizeBytes: stat.size,
    sha256,
  };
}

export class VideoStudioProvider {
  private db: DB;
  private coordinator: any;
  private ttsProvider: LocalTTSProvider;

  constructor(db: DB, coordinator?: any, ttsProvider?: LocalTTSProvider) {
    this.db = db;
    this.coordinator = coordinator;
    this.ttsProvider = ttsProvider || new LocalTTSProvider();
  }

  public getSupportedAspectRatios(): readonly AspectRatioPreset[] {
    return ASPECT_RATIO_PRESETS;
  }

  public getSupportedCanvasStyles() {
    return CANVAS_STYLES;
  }

  public async composeVideo(options: VideoCompositionOptions): Promise<ComposedVideoResult> {
    const startTime = Date.now();
    const timestamp = Date.now();

    // 1. Validate Target Aspect Ratio
    const preset = ASPECT_RATIO_PRESETS.find((p) => p.id === options.aspectRatio);
    if (!preset) {
      throw new Error(`INVALID_ASPECT_RATIO: Unsupported aspect ratio "${options.aspectRatio}". Supported: 9:16, 16:9, 1:1`);
    }
    const targetW = preset.width;
    const targetH = preset.height;
    const canvasStyle: CanvasStyleType = options.canvasStyle || 'stage_matte';

    // 2. Validate Character & Animation
    const character = this.db.prepare('SELECT id, name, brandId, referenceImage FROM characters WHERE id=?').get(options.characterId) as any;
    if (!character) {
      throw new Error(`CHARACTER_NOT_FOUND: Character ID ${options.characterId} does not exist`);
    }

    const animation = this.db.prepare('SELECT * FROM character_animations WHERE id=?').get(options.animationId) as any;
    if (!animation) {
      throw new Error(`ANIMATION_NOT_FOUND: Animation ID ${options.animationId} does not exist`);
    }
    if (animation.characterId !== character.id) {
      throw new Error(`ANIMATION_CHARACTER_MISMATCH: Animation ID ${options.animationId} does not belong to Character "${character.name}"`);
    }

    const animFilename = path.basename(animation.videoUrl);
    const animDiskPath = path.resolve('./data/storage/videos', animFilename);
    if (!fs.existsSync(animDiskPath)) {
      throw new Error(`ANIMATION_FILE_MISSING: Source animation video file "${animFilename}" not found on disk`);
    }

    // 3. Prepare Output Paths
    const videosDir = path.resolve('./data/storage/videos');
    const audioDir = path.resolve('./data/storage/audio');
    fs.mkdirSync(videosDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });

    const safeTitleSlug = options.title.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
    const outFilename = `composed_${safeTitleSlug}_${timestamp}.mp4`;
    const outputPath = options.outputVideoPath || path.join(videosDir, outFilename);
    const videoUrl = `/api/media/videos/${outFilename}`;
    const thumbFilename = `thumb_${safeTitleSlug}_${timestamp}.png`;
    const thumbPath = path.join(videosDir, thumbFilename);
    const thumbUrl = `/api/media/videos/${thumbFilename}`;
    const contactSheetFilename = `contact_${safeTitleSlug}_${timestamp}.png`;
    const contactSheetPath = path.join(videosDir, contactSheetFilename);
    const contactSheetUrl = `/api/media/videos/${contactSheetFilename}`;

    // 4. Resource coordinator admission reservation if active
    let reservationId: string | null = null;
    if (this.coordinator && typeof this.coordinator.requestReservation === 'function') {
      try {
        const res = await this.coordinator.requestReservation({
          resourceType: 'CPU_VIDEO_RENDER',
          requesterId: `video_studio_${options.characterId}_${timestamp}`,
          priority: 'NORMAL',
        });
        if (res && res.reservationId) {
          reservationId = res.reservationId;
        }
      } catch (err) {
        console.warn('[VideoStudio] Coordinator reservation request failed:', err);
      }
    }

    let tempNarrationPath: string | null = null;
    let tempOverlayPath: string | null = null;

    try {
      // 5. Narration Synthesis (if requested)
      let narrationDuration = 0;
      const narrationText = options.narrationText?.trim();
      if (narrationText) {
        try {
          const ttsRes = await this.ttsProvider.synthesize(
            narrationText,
            options.narrationVoice || 'Samantha'
          );
          tempNarrationPath = ttsRes.filePath;
          narrationDuration = ttsRes.durationSec;
        } catch (err: any) {
          console.warn('[VideoStudio] TTS synthesis failed:', err);
        }
      }

      // 6. Calculate total target duration
      // If narration is present and longer than source animation, loop animation to match narration
      const animDuration = Number(animation.durationSec) || 2.0;
      const targetDuration = Math.max(animDuration, narrationDuration, 1.5);

      // 7. Generate Typography Overlay (Header Title, Subtitle, Character Badge)
      const hasTitle = !!options.titleOverlay?.trim();
      const hasSubtitle = !!options.subtitleText?.trim();
      const hasBadge = options.characterBadge !== false;
      const needsOverlay = hasTitle || hasSubtitle || hasBadge;

      if (needsOverlay) {
        tempOverlayPath = path.join(videosDir, `ovr_${timestamp}_${Math.random().toString(36).slice(2, 6)}.png`);
        const pythonBin = getPythonPath();
        const overlayScript = path.resolve('./server/scripts/generate_video_overlay.py');

        const args = [
          overlayScript,
          '--width', String(targetW),
          '--height', String(targetH),
          '--output', tempOverlayPath,
        ];
        if (hasTitle) args.push('--title', options.titleOverlay!.trim());
        if (hasSubtitle) args.push('--subtitle', options.subtitleText!.trim());
        if (hasBadge) args.push('--character-name', character.name);

        await execFileAsync(pythonBin, args, { maxBuffer: 10 * 1024 * 1024 });
      }

      // 8. Background Music resolution
      let bgmPath: string | null = null;
      if (options.bgmTrack && options.bgmTrack !== 'none') {
        const candidateBgm = path.resolve(audioDir, options.bgmTrack.endsWith('.mp3') ? options.bgmTrack : `${options.bgmTrack}.mp3`);
        if (fs.existsSync(candidateBgm) && fs.statSync(candidateBgm).size > 0) {
          bgmPath = candidateBgm;
        } else {
          // Fallback to auravo ambient lounge if it exists
          const ambientPath = path.resolve(audioDir, 'auravo_ambient_lounge.mp3');
          if (fs.existsSync(ambientPath)) {
            bgmPath = ambientPath;
          }
        }
      }

      // 9. Assemble FFmpeg filter complex & command arguments
      const ffmpegBin = getFfmpegPath();
      const ffmpegArgs: string[] = ['-y'];

      // Input 0: Source Animation (stream looped to fill targetDuration)
      ffmpegArgs.push('-stream_loop', '-1', '-i', animDiskPath);

      // Input 1 (optional): Overlay PNG
      let overlayInputIdx = -1;
      if (tempOverlayPath && fs.existsSync(tempOverlayPath)) {
        overlayInputIdx = 1;
        ffmpegArgs.push('-i', tempOverlayPath);
      }

      // Audio Inputs
      let voiceInputIdx = -1;
      let bgmInputIdx = -1;
      let currentInputIdx = overlayInputIdx !== -1 ? 2 : 1;

      if (tempNarrationPath && fs.existsSync(tempNarrationPath) && fs.statSync(tempNarrationPath).size > 1024) {
        voiceInputIdx = currentInputIdx++;
        ffmpegArgs.push('-i', tempNarrationPath);
      }

      if (bgmPath && fs.existsSync(bgmPath) && fs.statSync(bgmPath).size > 0) {
        bgmInputIdx = currentInputIdx++;
        ffmpegArgs.push('-stream_loop', '-1', '-i', bgmPath);
      }

      // Build video filter graph
      const filterParts: string[] = [];

      if (canvasStyle === 'blurred_backdrop') {
        filterParts.push(
          `[0:v]split=2[fg_in][bg_in]`,
          `[bg_in]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=25:5,setsar=1[bg_blur]`,
          `[fg_in]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[fg_scaled]`,
          `[bg_blur][fg_scaled]overlay=(${targetW}-w)/2:(${targetH}-h)/2,setsar=1[base_canvas]`
        );
      } else if (canvasStyle === 'cinematic_letterbox') {
        filterParts.push(
          `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[base_canvas]`
        );
      } else if (canvasStyle === 'full_bleed') {
        filterParts.push(
          `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}:(in_w-${targetW})/2:(in_h-${targetH})/2,setsar=1[base_canvas]`
        );
      } else {
        // Default: stage_matte (deep midnight slate #0f172a)
        filterParts.push(
          `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1[base_canvas]`
        );
      }

      if (overlayInputIdx !== -1) {
        filterParts.push(`[${overlayInputIdx}:v]setsar=1[ovr_in]`, `[base_canvas][ovr_in]overlay=0:0,scale=${targetW}:${targetH},setsar=1,format=yuv420p[vout]`);
      } else {
        filterParts.push(`[base_canvas]scale=${targetW}:${targetH},setsar=1,format=yuv420p[vout]`);
      }

      // Build audio filter graph
      const hasVoice = voiceInputIdx !== -1;
      const hasBgm = bgmInputIdx !== -1;
      const voiceVol = Math.max(0.1, Math.min(2.0, options.voiceVolume ?? 1.1));
      const bgmVol = Math.max(0.05, Math.min(1.0, options.bgmVolume ?? 0.25));

      if (hasVoice && hasBgm) {
        filterParts.push(
          `[${voiceInputIdx}:a]volume=${voiceVol},aformat=channel_layouts=stereo[voice_a]`,
          `[${bgmInputIdx}:a]volume=${bgmVol},aformat=channel_layouts=stereo[bgm_a]`,
          `[voice_a][bgm_a]amix=inputs=2:duration=first:dropout_transition=2,aformat=channel_layouts=stereo[aout]`
        );
      } else if (hasVoice) {
        filterParts.push(`[${voiceInputIdx}:a]volume=${voiceVol},aformat=channel_layouts=stereo[aout]`);
      } else if (hasBgm) {
        filterParts.push(`[${bgmInputIdx}:a]volume=${bgmVol},aformat=channel_layouts=stereo[aout]`);
      }

      ffmpegArgs.push('-filter_complex', filterParts.join(';'));
      ffmpegArgs.push('-map', '[vout]');

      if (hasVoice || hasBgm) {
        ffmpegArgs.push(
          '-map', '[aout]',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ac', '2'
        );
      } else {
        ffmpegArgs.push('-an');
      }

      ffmpegArgs.push(
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-profile:v', 'main',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-g', '30',
        '-movflags', '+faststart',
        '-t', String(targetDuration),
        outputPath
      );

      // Execute FFmpeg render
      await execFileAsync(ffmpegBin, ffmpegArgs, { maxBuffer: 50 * 1024 * 1024 });

      // 10. Generate Thumbnail PNG (from mid-frame)
      const midSec = Math.max(0.5, targetDuration / 2);
      await execFileAsync(ffmpegBin, [
        '-y',
        '-ss', String(midSec),
        '-i', outputPath,
        '-vframes', '1',
        '-vf', 'scale=540:-1',
        thumbPath,
      ]);

      // 11. Generate Multi-Frame Contact Sheet PNG (8 frames showing progression)
      try {
        await execFileAsync(ffmpegBin, [
          '-y',
          '-i', outputPath,
          '-vf', 'fps=4,scale=320:426,tile=4x2',
          '-vframes', '1',
          contactSheetPath,
        ]);
      } catch (err) {
        console.warn('[VideoStudio] Contact sheet generation non-fatal failure:', err);
      }

      // 12. Validate Composed Video Output Container & Audio/Video Streams
      const probe = await validateComposedVideo(outputPath, {
        width: targetW,
        height: targetH,
        minDuration: 1.0,
        expectAudio: hasVoice || hasBgm,
      });

      const renderDurationMs = Date.now() - startTime;

      return {
        videoPath: outputPath,
        videoUrl,
        thumbnailUrl: thumbUrl,
        contactSheetUrl: fs.existsSync(contactSheetPath) ? contactSheetUrl : undefined,
        width: probe.width,
        height: probe.height,
        aspectRatio: options.aspectRatio,
        resolution: `${probe.width}x${probe.height}`,
        durationSec: probe.durationSec,
        fps: probe.fps,
        sha256: probe.sha256,
        fileSize: probe.fileSizeBytes,
        compositionConfig: {
          aspectRatio: options.aspectRatio,
          canvasStyle,
          titleOverlay: options.titleOverlay,
          subtitleText: options.subtitleText,
          characterBadge: hasBadge,
        },
        audioConfig: {
          narrationText: options.narrationText,
          narrationVoice: options.narrationVoice || 'Samantha',
          bgmTrack: options.bgmTrack,
          voiceVolume: voiceVol,
          bgmVolume: bgmVol,
          hasAudio: probe.hasAudio,
          audioCodec: probe.audioCodec,
        },
        subtitleConfig: {
          subtitleText: options.subtitleText,
          renderedInOverlay: hasSubtitle,
        },
        renderStats: {
          renderTimeMs: renderDurationMs,
          hasAudio: probe.hasAudio,
          audioChannels: probe.audioChannels || 0,
          canvasStyle,
        },
      };
    } finally {
      // Clean up temporary audio and overlay files
      if (tempNarrationPath && fs.existsSync(tempNarrationPath)) {
        try { fs.unlinkSync(tempNarrationPath); } catch (_) {}
      }
      if (tempOverlayPath && fs.existsSync(tempOverlayPath)) {
        try { fs.unlinkSync(tempOverlayPath); } catch (_) {}
      }
      // Release coordinator reservation
      if (reservationId && this.coordinator && typeof this.coordinator.releaseReservation === 'function') {
        try {
          await this.coordinator.releaseReservation(reservationId);
        } catch (_) {}
      }
    }
  }
}
