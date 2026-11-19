import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';
import { uid } from './crud.js';
import {
  VideoStudioProvider,
  ASPECT_RATIO_PRESETS,
  CANVAS_STYLES,
  computeFileSha256,
} from './providers/video_studio.js';

export function createVideoStudioRouter(db: DB, coordinator?: any) {
  const router = Router();
  const videoStudio = new VideoStudioProvider(db, coordinator);

  // 1. List supported aspect ratios and canvas styling presets
  router.get('/presets', (_req: Request, res: Response) => {
    res.json({
      aspectRatios: ASPECT_RATIO_PRESETS,
      canvasStyles: CANVAS_STYLES,
    });
  });

  // 2. List animations available for a character (owner-scoped)
  router.get('/animations/:characterId', (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const characterId = Number(req.params.characterId);

      const character = db.prepare('SELECT id, name FROM characters WHERE id=? AND ownerId=?').get(characterId, userId) as any;
      if (!character) {
        return res.status(404).json({ error: 'Character not found or not owned by user' });
      }

      const rows = db.prepare('SELECT * FROM character_animations WHERE characterId=? AND ownerId=? ORDER BY id DESC').all(characterId, userId) as any[];
      res.json({ ok: true, character, animations: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch character animations' });
    }
  });

  // 3. Compose a final video from character animation
  router.post('/compose', async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        characterId: z.number().int(),
        animationId: z.number().int(),
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        aspectRatio: z.enum(['9:16', '16:9', '1:1']),
        canvasStyle: z.enum(['stage_matte', 'blurred_backdrop', 'cinematic_letterbox', 'full_bleed']).optional().default('stage_matte'),
        titleOverlay: z.string().max(200).optional(),
        subtitleText: z.string().max(500).optional(),
        characterBadge: z.boolean().optional().default(true),
        narrationText: z.string().max(1000).optional(),
        narrationVoice: z.string().max(50).optional().default('Samantha'),
        bgmTrack: z.string().max(100).optional().default('auravo_ambient_lounge'),
        voiceVolume: z.number().min(0.0).max(2.0).optional().default(1.1),
        bgmVolume: z.number().min(0.0).max(1.0).optional().default(0.25),
        testMock: z.boolean().optional(),
      });

      const p = schema.safeParse(req.body);
      if (!p.success) {
        return res.status(400).json({ error: p.error.errors[0].message });
      }

      const userId = uid(req);
      const {
        characterId,
        animationId,
        title,
        description,
        aspectRatio,
        canvasStyle,
        titleOverlay,
        subtitleText,
        characterBadge,
        narrationText,
        narrationVoice,
        bgmTrack,
        voiceVolume,
        bgmVolume,
        testMock,
      } = p.data;

      // Verify character ownership
      const character = db.prepare('SELECT id, name, brandId FROM characters WHERE id=? AND ownerId=?').get(characterId, userId) as any;
      if (!character) {
        return res.status(404).json({ error: 'Character not found or not owned by user' });
      }

      // Verify animation ownership and character association
      const animation = db.prepare('SELECT * FROM character_animations WHERE id=? AND ownerId=?').get(animationId, userId) as any;
      if (!animation) {
        return res.status(404).json({ error: 'Animation not found or not owned by user' });
      }
      if (animation.characterId !== character.id) {
        return res.status(400).json({ error: 'Selected animation does not belong to the selected character' });
      }

      // Execute composition
      const result = await videoStudio.composeVideo({
        characterId,
        animationId,
        title,
        description,
        aspectRatio,
        canvasStyle,
        titleOverlay,
        subtitleText,
        characterBadge,
        narrationText,
        narrationVoice,
        bgmTrack,
        voiceVolume,
        bgmVolume,
        testMock,
      });

      res.json({ ok: true, result });
    } catch (err: any) {
      console.error('[VideoStudio] Composition error:', err);
      const isValidationErr = err.message && (
        err.message.includes('INVALID_') ||
        err.message.includes('_NOT_FOUND') ||
        err.message.includes('_MISMATCH') ||
        err.message.includes('_FILE_MISSING') ||
        err.message.includes('COMPOSED_VIDEO_')
      );
      const statusCode = isValidationErr ? 400 : 500;
      res.status(statusCode).json({ error: err.message || 'Video composition failed' });
    }
  });

  // 4. Save composed video to user's video library
  router.post('/save', (req: Request, res: Response) => {
    try {
      const schema = z.object({
        characterId: z.number().int(),
        animationId: z.number().int(),
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        aspectRatio: z.enum(['9:16', '16:9', '1:1']),
        resolution: z.string().min(3),
        width: z.number().int().min(64),
        height: z.number().int().min(64),
        durationSec: z.number().min(0.5).max(300),
        fps: z.number().int().min(15).max(60).optional().default(30),
        videoUrl: z.string().min(1),
        thumbnailUrl: z.string().optional(),
        sha256: z.string().min(32),
        fileSize: z.number().int().min(1),
        compositionConfig: z.any().optional(),
        audioConfig: z.any().optional(),
        subtitleConfig: z.any().optional(),
      });

      const p = schema.safeParse(req.body);
      if (!p.success) {
        return res.status(400).json({ error: p.error.errors[0].message });
      }

      const userId = uid(req);
      const {
        characterId,
        animationId,
        title,
        description,
        aspectRatio,
        resolution,
        width,
        height,
        durationSec,
        fps,
        videoUrl,
        thumbnailUrl,
        sha256,
        fileSize,
        compositionConfig,
        audioConfig,
        subtitleConfig,
      } = p.data;

      // Verify character ownership
      const character = db.prepare('SELECT id, brandId FROM characters WHERE id=? AND ownerId=?').get(characterId, userId) as any;
      if (!character) {
        return res.status(404).json({ error: 'Character not found or not owned by user' });
      }

      // Verify animation ownership
      const animation = db.prepare('SELECT id FROM character_animations WHERE id=? AND ownerId=?').get(animationId, userId) as any;
      if (!animation) {
        return res.status(404).json({ error: 'Animation not found or not owned by user' });
      }

      // Verify video file exists on disk
      const videoFilename = path.basename(videoUrl);
      const videoPath = path.resolve('./data/storage/videos', videoFilename);
      if (!fs.existsSync(videoPath)) {
        return res.status(400).json({ error: 'Referenced video file does not exist on disk' });
      }

      // Verify SHA-256 match
      const diskSha = computeFileSha256(videoPath);
      if (diskSha !== sha256) {
        return res.status(400).json({ error: 'SHA-256 digest mismatch with disk video asset' });
      }

      const info = db.prepare(`
        INSERT INTO character_videos (
          ownerId, brandId, characterId, animationId, title, description,
          aspectRatio, resolution, width, height, durationSec, fps,
          videoUrl, thumbnailUrl, sha256, fileSize,
          compositionConfig, audioConfig, subtitleConfig,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        userId,
        character.brandId,
        character.id,
        animation.id,
        title,
        description || '',
        aspectRatio,
        resolution,
        width,
        height,
        durationSec,
        fps,
        videoUrl,
        thumbnailUrl || '',
        sha256,
        fileSize,
        JSON.stringify(compositionConfig || {}),
        JSON.stringify(audioConfig || {}),
        JSON.stringify(subtitleConfig || {})
      );

      const savedRow = db.prepare('SELECT * FROM character_videos WHERE id=?').get(info.lastInsertRowid) as any;
      res.status(201).json({ ok: true, video: savedRow });
    } catch (err: any) {
      console.error('[VideoStudio] Save error:', err);
      res.status(500).json({ error: err.message || 'Failed to save composed video asset' });
    }
  });

  // 5. List saved videos (owner-scoped)
  router.get('/', (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const characterId = req.query.characterId ? Number(req.query.characterId) : null;

      let query = 'SELECT * FROM character_videos WHERE ownerId=?';
      const params: any[] = [userId];

      if (characterId) {
        query += ' AND characterId=?';
        params.push(characterId);
      }
      query += ' ORDER BY id DESC';

      const rows = db.prepare(query).all(...params) as any[];
      res.json({ ok: true, videos: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch videos' });
    }
  });

  // 6. Get single saved video (owner-scoped)
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const row = db.prepare('SELECT * FROM character_videos WHERE id=? AND ownerId=?').get(req.params.id, userId) as any;
      if (!row) {
        return res.status(404).json({ error: 'Video not found' });
      }
      res.json({ ok: true, video: row });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch video' });
    }
  });

  // 7. Delete saved video (owner-scoped)
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const row = db.prepare('SELECT * FROM character_videos WHERE id=? AND ownerId=?').get(req.params.id, userId) as any;
      if (!row) {
        return res.status(404).json({ error: 'Video not found' });
      }

      if (row.videoUrl) {
        const fPath = path.resolve('./data/storage/videos', path.basename(row.videoUrl));
        if (fs.existsSync(fPath)) {
          try { fs.unlinkSync(fPath); } catch (_) {}
        }
      }
      if (row.thumbnailUrl) {
        const tPath = path.resolve('./data/storage/videos', path.basename(row.thumbnailUrl));
        if (fs.existsSync(tPath)) {
          try { fs.unlinkSync(tPath); } catch (_) {}
        }
      }

      db.prepare('DELETE FROM character_videos WHERE id=? AND ownerId=?').run(req.params.id, userId);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete video' });
    }
  });

  return router;
}

