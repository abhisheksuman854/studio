import express, { type Request, type Response, type Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { DB } from './db.js';
import { uid } from './crud.js';
import { LocalTTSProvider } from './providers/tts.js';
import { LocalImageProvider } from './providers/image.js';
import { FFmpegVideoProvider, generateSrtContent } from './providers/video.js';
import { QualityGateEngine } from './providers/quality_gate.js';
import { DANCER_ARCHETYPES, getPersistedAudioMode } from './content_engine.js';
import { resolveAudioMode } from './providers/types.js';

export type JobStatus =
  | 'QUEUED'
  | 'INITIALIZING'
  | 'GENERATING_CHARACTER'
  | 'ANIMATING_FACE'
  | 'GENERATING_MOTION'
  | 'SYNTHESIZING_VOICE'
  | 'RENDERING_MASTER'
  | 'QUALITY_CHECK'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type PublicJobErrorCategory =
  | 'GENERATION_FAILED'
  | 'RENDER_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'INTERNAL_ERROR';

/**
 * Maps raw internal error messages or diagnostic traces to a safe, public error category.
 * Prevents disclosure of local filesystem paths (/Users/...), FFmpeg stderr, provider traces,
 * or environment variables in client-facing API responses.
 */
export function sanitizeJobError(rawError: string | null | undefined): PublicJobErrorCategory | null {
  if (!rawError) return null;
  const trimmed = rawError.trim();
  if (!trimmed) return null;

  // If already one of the canonical safe categories, return as-is
  if (
    trimmed === 'GENERATION_FAILED' ||
    trimmed === 'RENDER_FAILED' ||
    trimmed === 'PROVIDER_UNAVAILABLE' ||
    trimmed === 'INVALID_INPUT' ||
    trimmed === 'INTERNAL_ERROR'
  ) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();

  // Classify failure domains safely
  if (
    lower.includes('input') ||
    lower.includes('invalid') ||
    lower.includes('not found') ||
    lower.includes('missing') ||
    lower.includes('empty') ||
    lower.includes('bad request')
  ) {
    return 'INVALID_INPUT';
  }
  if (
    lower.includes('ffmpeg') ||
    lower.includes('render') ||
    lower.includes('audio') ||
    lower.includes('video') ||
    lower.includes('composition') ||
    lower.includes('codec') ||
    lower.includes('concat') ||
    lower.includes('filter') ||
    lower.includes('zoompan') ||
    lower.includes('libx264')
  ) {
    return 'RENDER_FAILED';
  }
  if (
    lower.includes('character') ||
    lower.includes('portrait') ||
    lower.includes('prompt') ||
    lower.includes('denoise') ||
    lower.includes('diffusion') ||
    lower.includes('sdxl') ||
    lower.includes('unet') ||
    lower.includes('vae')
  ) {
    return 'GENERATION_FAILED';
  }
  if (
    lower.includes('unreachable') ||
    lower.includes('econnrefused') ||
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('gpu worker') ||
    lower.includes('timed out') ||
    lower.includes('fetch failed')
  ) {
    return 'PROVIDER_UNAVAILABLE';
  }

  return 'INTERNAL_ERROR';
}

export interface JobRecord {
  id: string;
  ownerId: number;
  contentItemId: number | null;
  sceneId: number | null;
  type: string;
  status: JobStatus;
  progress: number;
  currentStage: string | null;
  error: string | null;
  inputPayload: string;
  resultPayload: string;
  createdAt: string;
  updatedAt: string;
}

export class JobManager {
  private db: DB;
  private tts = new LocalTTSProvider();
  private imageProvider = new LocalImageProvider();
  private videoProvider = new FFmpegVideoProvider();

  constructor(db: DB) {
    this.db = db;
  }

  createJob(options: {
    ownerId: number;
    contentItemId?: number | null;
    sceneId?: number | null;
    type: string;
    inputPayload?: Record<string, any>;
  }): JobRecord {
    const id = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO jobs (id, ownerId, contentItemId, sceneId, type, status, progress, currentStage, inputPayload, resultPayload, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 'QUEUED', 0, 'Job queued in background', ?, '{}', ?, ?)
    `).run(
      id,
      options.ownerId,
      options.contentItemId || null,
      options.sceneId || null,
      options.type,
      JSON.stringify(options.inputPayload || {}),
      now,
      now
    );

    return this.getJob(id, options.ownerId)!;
  }

  getJob(id: string, ownerId: number): JobRecord | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id=? AND ownerId=?').get(id, ownerId) as JobRecord | undefined;
  }

  listJobs(ownerId: number, limit = 20): JobRecord[] {
    return this.db.prepare('SELECT * FROM jobs WHERE ownerId=? ORDER BY createdAt DESC LIMIT ?').all(ownerId, limit) as JobRecord[];
  }

  updateProgress(
    jobId: string,
    ownerId: number,
    update: {
      status?: JobStatus;
      progress?: number;
      currentStage?: string;
      resultPayload?: Record<string, any>;
      error?: string | null;
    }
  ): void {
    const sets: string[] = ['updatedAt = CURRENT_TIMESTAMP'];
    const params: any[] = [];

    if (update.status !== undefined) {
      sets.push('status = ?');
      params.push(update.status);
    }
    if (update.progress !== undefined) {
      sets.push('progress = ?');
      params.push(Math.min(100, Math.max(0, update.progress)));
    }
    if (update.currentStage !== undefined) {
      sets.push('currentStage = ?');
      params.push(update.currentStage);
    }
    if (update.resultPayload !== undefined) {
      sets.push('resultPayload = ?');
      params.push(JSON.stringify(update.resultPayload));
    }
    if (update.error !== undefined) {
      sets.push('error = ?');
      params.push(update.error);
    }

    params.push(jobId, ownerId);
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id=? AND ownerId=?`).run(...params);
  }

  cancelJob(jobId: string, ownerId: number): boolean {
    const job = this.getJob(jobId, ownerId);
    if (!job || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
      return false;
    }
    this.updateProgress(jobId, ownerId, {
      status: 'CANCELLED',
      currentStage: 'Job cancelled by user',
    });
    return true;
  }

  /**
   * Executes the 5-Beat Video Generation Pipeline asynchronously with live progress reporting.
   */
  async startRenderPipelineAsync(jobId: string, contentItemId: number, ownerId: number, audioModeParam?: string): Promise<void> {
    // Run in background without blocking caller
    setImmediate(async () => {
      try {
        const item = this.db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(contentItemId, ownerId) as any;
        if (!item) throw new Error('Content item not found');

        const script = this.db.prepare('SELECT * FROM scripts WHERE contentItemId=?').get(contentItemId) as any;
        if (!script) throw new Error('Script missing for content item');

        const scenes = this.db.prepare('SELECT * FROM scenes WHERE scriptId=? ORDER BY sceneOrder ASC').all(script.id) as any[];
        if (scenes.length === 0) throw new Error('Script has no scenes');

        const brand = this.db.prepare('SELECT * FROM brands WHERE id=? AND ownerId=?').get(item.brandId, ownerId) as any;
        if (!brand) throw new Error('Brand not found');

        // Stage 1: Initializing
        this.updateProgress(jobId, ownerId, {
          status: 'INITIALIZING',
          progress: 10,
          currentStage: 'Preparing multi-beat scene specifications and storage assets...',
        });

        const baseStorage = path.resolve('./data/storage');
        const imgDir = path.join(baseStorage, 'images');
        const audioDir = path.join(baseStorage, 'audio');
        const subDir = path.join(baseStorage, 'subtitles');
        const vidDir = path.join(baseStorage, 'videos');
        [imgDir, audioDir, subDir, vidDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));

        // Stage 2: Audio Track (Pure Song Music vs Voiceover)
        const musicAsset = this.db.prepare("SELECT * FROM assets WHERE contentItemId=? AND type='MUSIC' ORDER BY id DESC").get(contentItemId) as any;
        const customMusicPath = musicAsset?.filePath && fs.existsSync(musicAsset.filePath) ? musicAsset.filePath : undefined;
        const currentJob = this.getJob(jobId, ownerId);
        const payload = typeof currentJob?.inputPayload === 'string' ? JSON.parse(currentJob.inputPayload) : currentJob?.inputPayload;
        const resolvedAudio = resolveAudioMode(
          audioModeParam || payload?.audioMode,
          getPersistedAudioMode(this.db, contentItemId)
        );
        const audioMode = resolvedAudio.mode;

        let audioPath = '';
        if (audioMode !== 'music_only') {
          this.updateProgress(jobId, ownerId, {
            status: 'SYNTHESIZING_VOICE',
            progress: 25,
            currentStage: 'Synthesizing voice narration and rhythm cadence for 5 beats...',
          });

          const fullNarration = scenes.map((s) => s.narration).filter(Boolean).join('. ');
          if (fullNarration.trim()) {
            const mainAudioFile = path.join(audioDir, `narration_${contentItemId}_${Date.now()}.mp3`);
            const { filePath } = await this.tts.synthesize(fullNarration, 'Samantha', mainAudioFile);
            audioPath = filePath;

            this.db.prepare(`
              INSERT INTO assets(ownerId, contentItemId, type, provider, prompt, filePath, mimeType)
              VALUES (?, ?, 'AUDIO', 'LocalTTS', ?, ?, 'audio/mpeg')
            `).run(ownerId, contentItemId, fullNarration, audioPath);
          }
        } else {
          this.updateProgress(jobId, ownerId, {
            status: 'SYNTHESIZING_VOICE',
            progress: 25,
            currentStage: 'Configuring pure song music soundtrack (100% Hindi music, no narration)...',
          });
        }

        // Stage 3: Visual Assets & Character Model Rendering
        this.updateProgress(jobId, ownerId, {
          status: 'GENERATING_CHARACTER',
          progress: 45,
          currentStage: 'Rendering 9:16 vertical scene artwork and lighting compositions...',
        });

        const renderedScenes: Array<{ imagePath?: string; videoClipPath?: string; narration: string; durationSec: number }> = [];

        // Match dancer persona portrait
        let characterPortraitPath: string | undefined;
        const charCandidates = this.db.prepare('SELECT * FROM characters WHERE brandId=? AND ownerId=? ORDER BY id DESC').all(brand.id, ownerId) as any[];
        const fullContentText = `${item.title || ''} ${item.premise || ''} ${item.hook || ''} ${scenes.map(s => s.visualPrompt).join(' ')}`.toLowerCase();

        let matchedChar = charCandidates.find(c => fullContentText.includes(c.name.toLowerCase()));
        if (!matchedChar && charCandidates.length > 0) matchedChar = charCandidates[0];

        if (matchedChar) {
          if (matchedChar.referenceImage) {
            const filename = matchedChar.referenceImage.split('/').pop() || '';
            const refPath = path.join(imgDir, filename);
            if (fs.existsSync(refPath)) characterPortraitPath = refPath;
          }
          if (!characterPortraitPath) {
            const arc = DANCER_ARCHETYPES.find(a => a.name.toLowerCase() === matchedChar.name.toLowerCase());
            if (arc?.portraitUrl) {
              const filename = arc.portraitUrl.split('/').pop() || '';
              const arcPath = path.join(imgDir, filename);
              if (fs.existsSync(arcPath)) characterPortraitPath = arcPath;
            }
          }
        }
        if (!characterPortraitPath) {
          if (fullContentText.includes('zara')) {
            const arcPath = path.join(imgDir, 'zara_portrait.jpg');
            if (fs.existsSync(arcPath)) characterPortraitPath = arcPath;
          } else if (fullContentText.includes('priya') || fullContentText.includes('saree')) {
            const arcPath = path.join(imgDir, 'priya_portrait.jpg');
            if (fs.existsSync(arcPath)) characterPortraitPath = arcPath;
          } else {
            const defaultArc = path.join(imgDir, 'zara_portrait.jpg');
            if (fs.existsSync(defaultArc)) characterPortraitPath = defaultArc;
          }
        }

        let sceneIdx = 0;
        for (const sc of scenes) {
          const currentJobState = this.getJob(jobId, ownerId);
          if (currentJobState?.status === 'CANCELLED') {
            console.log(`[JobManager] Job ${jobId} was cancelled by user. Terminating render pipeline.`);
            return;
          }

          sceneIdx++;
          const progressStep = 45 + Math.round((sceneIdx / scenes.length) * 25);
          this.updateProgress(jobId, ownerId, {
            status: 'GENERATING_MOTION',
            progress: progressStep,
            currentStage: `Synthesizing choreography visual beat ${sc.sceneOrder} of 5...`,
          });

          const sceneVideoAsset = this.db.prepare("SELECT * FROM assets WHERE contentItemId=? AND sceneId=? AND type='SCENE_VIDEO'").get(contentItemId, sc.id) as any;
          const refSliceAsset = this.db.prepare("SELECT * FROM assets WHERE contentItemId=? AND sceneId=? AND type='REFERENCE_SLICE' ORDER BY id DESC").get(contentItemId, sc.id) as any;
          let videoClipPath: string | undefined;
          let imgPath: string | undefined;

          if (sceneVideoAsset && fs.existsSync(sceneVideoAsset.filePath)) {
            videoClipPath = sceneVideoAsset.filePath;
          } else if (refSliceAsset && fs.existsSync(refSliceAsset.filePath)) {
            videoClipPath = refSliceAsset.filePath;
          } else {
            const sceneImgFile = path.join(imgDir, `scene_${contentItemId}_${sc.sceneOrder}_${Date.now()}.png`);
            const { filePath: genImgPath } = await this.imageProvider.generateSceneImage(
              sc.visualPrompt,
              brand.visualStyle || 'cinematic',
              sceneImgFile,
              `BEAT ${sc.sceneOrder}: ${sc.endingType || 'DANCE'}`,
              sc.narration,
              characterPortraitPath
            );
            imgPath = genImgPath;

            this.db.prepare(`
              INSERT INTO assets(ownerId, contentItemId, sceneId, type, provider, prompt, filePath, mimeType)
              VALUES (?, ?, ?, 'IMAGE', 'LocalImageProvider', ?, ?, 'image/png')
            `).run(ownerId, contentItemId, sc.id, sc.visualPrompt, imgPath);
          }

          renderedScenes.push({
            imagePath: imgPath,
            videoClipPath: videoClipPath,
            narration: sc.narration,
            durationSec: sc.durationSec,
          });
        }

        // Subtitles
        const srtContent = generateSrtContent(renderedScenes);
        const srtFile = path.join(subDir, `subtitles_${contentItemId}.srt`);
        fs.writeFileSync(srtFile, srtContent, 'utf8');

        this.db.prepare(`
          INSERT INTO assets(ownerId, contentItemId, type, provider, filePath, mimeType)
          VALUES (?, ?, 'SUBTITLE', 'LocalSubtitles', ?, 'text/plain')
        `).run(ownerId, contentItemId, srtFile);

        const preRenderJob = this.getJob(jobId, ownerId);
        if (preRenderJob?.status === 'CANCELLED') {
          console.log(`[JobManager] Job ${jobId} was cancelled before master render.`);
          return;
        }

        // Stage 4: FFmpeg Master Rendering & Audio Mixing
        this.updateProgress(jobId, ownerId, {
          status: 'RENDERING_MASTER',
          progress: 75,
          currentStage: 'Composing 1080x1920 9:16 master MP4 with layered Bollywood beat mixing...',
        });

        const videoOutFile = path.join(vidDir, `short_${contentItemId}_master.mp4`);
        const { filePath: finalVideoPath, durationSec: totalDuration } = await this.videoProvider.renderShort({
          scenes: renderedScenes,
          audioTrackPath: audioPath,
          musicTrackPath: customMusicPath,
          audioMode: audioMode as any,
          subtitlesSrtPath: srtFile,
          outputPath: videoOutFile,
          title: item.title,
        });

        this.db.prepare(`
          INSERT INTO assets(ownerId, contentItemId, type, provider, filePath, mimeType, metadata)
          VALUES (?, ?, 'VIDEO', 'FFmpeg', ?, 'video/mp4', ?)
        `).run(ownerId, contentItemId, finalVideoPath, JSON.stringify({ durationSec: totalDuration, resolution: '1080x1920', aspectRatio: '9:16' }));

        // Stage 5: Quality Gate & Compliance Evaluation
        this.updateProgress(jobId, ownerId, {
          status: 'QUALITY_CHECK',
          progress: 92,
          currentStage: 'Running automated safety compliance and originality validation...',
        });

        const assets = this.db.prepare('SELECT * FROM assets WHERE contentItemId=?').all(contentItemId) as any[];
        const history = this.db.prepare('SELECT title, premise FROM originality_fingerprints WHERE brandId=? AND ownerId=?').all(brand.id, ownerId) as any[];

        const report = QualityGateEngine.evaluate({
          brand,
          script,
          scenes,
          assets,
          history,
          audioMode,
        });

        this.db.prepare(`
          INSERT INTO quality_reports(contentItemId, passed, safetyScore, checksJson)
          VALUES (?, ?, ?, ?)
        `).run(contentItemId, report.passed ? 1 : 0, report.safetyScore, JSON.stringify(report.checks));

        this.db.prepare("UPDATE content_items SET status='READY_FOR_REVIEW' WHERE id=?").run(contentItemId);

        // Stage 6: Completed
        this.updateProgress(jobId, ownerId, {
          status: 'COMPLETED',
          progress: 100,
          currentStage: 'Video production completed and ready for review!',
          resultPayload: {
            contentItemId,
            videoPath: finalVideoPath,
            videoUrl: `/storage/videos/${path.basename(finalVideoPath)}`,
            durationSec: totalDuration,
            safetyScore: report.safetyScore,
            canPublish: report.canPublish,
          },
        });
      } catch (err: any) {
        console.error(`[Job ${jobId} Failed]:`, err);
        const safeError = sanitizeJobError(err?.message) || 'INTERNAL_ERROR';
        this.updateProgress(jobId, ownerId, {
          status: 'FAILED',
          currentStage: 'Job failed during execution',
          error: safeError,
        });
      }
    });
  }
}

export function createJobsRouter(db: DB): Router {
  const router = express.Router();
  const manager = new JobManager(db);

  // List recent jobs for authenticated user (public responses sanitized on read)
  router.get('/jobs', (req: Request, res: Response) => {
    const userId = uid(req);
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const jobs = manager.listJobs(userId, limit).map((j) => ({
      ...j,
      error: sanitizeJobError(j.error),
    }));
    res.json(jobs);
  });

  // Get single job status (polling endpoint; public response sanitized on read)
  router.get('/jobs/:id', (req: Request, res: Response) => {
    const userId = uid(req);
    const job = manager.getJob(req.params.id, userId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({
      ...job,
      error: sanitizeJobError(job.error),
    });
  });

  // Cancel a running job
  router.delete('/jobs/:id', (req: Request, res: Response) => {
    const userId = uid(req);
    const ok = manager.cancelJob(req.params.id, userId);
    if (!ok) return res.status(400).json({ error: 'Job cannot be cancelled or was not found' });
    res.json({ ok: true, status: 'CANCELLED' });
  });

  // Trigger Asynchronous 5-Beat Video Rendering Job
  router.post('/content/:id/render-async', async (req: Request, res: Response) => {
    try {
      const contentItemId = Number(req.params.id);
      const userId = uid(req);

      const item = db.prepare('SELECT id, title FROM content_items WHERE id=? AND ownerId=?').get(contentItemId, userId) as any;
      if (!item) return res.status(404).json({ error: 'Content item not found' });

      const reqAudioMode = req.body?.audioMode;
      const persistedAudioMode = getPersistedAudioMode(db, contentItemId);
      const resolvedAudio = resolveAudioMode(reqAudioMode, persistedAudioMode);
      if (resolvedAudio.error) {
        return res.status(400).json({ error: resolvedAudio.error });
      }
      const audioMode = resolvedAudio.mode;

      // Create new job in QUEUED state
      const job = manager.createJob({
        ownerId: userId,
        contentItemId,
        type: 'FULL_VIDEO_RENDER',
        inputPayload: { contentItemId, title: item.title, audioMode },
      });

      // Start asynchronous pipeline in background
      manager.startRenderPipelineAsync(job.id, contentItemId, userId, audioMode);

      res.status(202).json({
        ok: true,
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        currentStage: job.currentStage,
        pollUrl: `/api/jobs/${job.id}`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to queue render job' });
    }
  });

  return router;
}
