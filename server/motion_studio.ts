import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';
import { uid } from './crud.js';
import {
  MotionGeneratorProvider,
  SUPPORTED_MOTION_PRESETS,
  computeFileSha256,
} from './providers/motion_gen.js';

export function createMotionStudioRouter(db: DB, coordinator?: any) {
  const router = Router();
  const motionGen = new MotionGeneratorProvider(db, coordinator);

  // 1. List available motion presets
  router.get('/presets', (_req: Request, res: Response) => {
    res.json(SUPPORTED_MOTION_PRESETS);
  });

  // 2. Generate genuine character animation
  router.post('/generate', async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        characterId: z.number().int(),
        preset: z.string().min(1).max(50),
        durationSec: z.number().min(1.0).max(6.0).optional().default(2.0),
        fps: z.number().int().min(15).max(60).optional().default(30),
        description: z.string().max(500).optional(),
        seed: z.number().int().optional(),
        testMock: z.boolean().optional(),
      });

      const p = schema.safeParse(req.body);
      if (!p.success) {
        return res.status(400).json({ error: p.error.errors[0].message });
      }

      const userId = uid(req);
      const { characterId, preset, durationSec, fps, description, seed, testMock } = p.data;

      // Verify character ownership
      const character = db.prepare('SELECT * FROM characters WHERE id=? AND ownerId=?').get(characterId, userId) as any;
      if (!character) {
        return res.status(404).json({ error: 'Character not found or not owned by user' });
      }

      // Verify movement preset is supported
      if (!motionGen.isSupportedPreset(preset)) {
        return res.status(400).json({
          error: `Unsupported movement preset: "${preset}". Supported: ${SUPPORTED_MOTION_PRESETS.map((x) => x.name).join(', ')}`,
        });
      }

      // Check for source image: either referenceImage or fallback
      let sourceImage = character.referenceImage;
      if (!sourceImage) {
        // Fallback: check if an image for this character exists in data/storage/images
        const files = fs.readdirSync(path.resolve('./data/storage/images')).filter((f) => f.includes(character.name.toLowerCase().replace(/[^a-z0-9]/g, '_')));
        if (files.length > 0) {
          sourceImage = `/api/media/images/${files[0]}`;
        }
      }

      if (!sourceImage) {
        return res.status(400).json({
          error: `Character "${character.name}" has no reference portrait image saved. Please generate or assign a portrait first in Character Studio.`,
        });
      }

      const filename = path.basename(sourceImage);
      const sourceDiskPath = path.resolve('./data/storage/images', filename);

      const result = await motionGen.generateMotionAnimation({
        characterId: character.id,
        characterName: character.name,
        sourceImagePath: sourceDiskPath,
        preset,
        durationSec,
        fps,
        seed,
        description,
        testMock,
      });

      res.json(result);
    } catch (err: any) {
      console.error('[MotionStudio] Generation error:', err);
      const isKnownCategory = err.message && (
        err.message.includes('CHARACTER_ASSET_') ||
        err.message.includes('ANIMATION_') ||
        err.message.includes('STATIC_FRAME_REJECTED') ||
        err.message.includes('EXPECTED_MOTION_NOT_DETECTED') ||
        err.message.includes('BACKGROUND_DEFORMATION_DETECTED') ||
        err.message.includes('VIDEO_ENCODING_FAILED')
      );
      const statusCode = isKnownCategory ? 400 : 500;
      res.status(statusCode).json({ error: err.message || 'Animation generation failed' });
    }
  });

  // 3. Save animation to character library
  router.post('/save', (req: Request, res: Response) => {
    try {
      const schema = z.object({
        characterId: z.number().int(),
        title: z.string().min(1).max(200),
        preset: z.string().min(1).max(50),
        description: z.string().max(1000).optional(),
        videoUrl: z.string().min(1),
        durationSec: z.number().min(0.5).max(60),
        fps: z.number().int().min(15).max(60).optional().default(30),
        width: z.number().int().min(64),
        height: z.number().int().min(64),
        sha256: z.string().min(32),
        fileSize: z.number().int().min(1),
        modelUsed: z.string().optional().default('AURAVO_LOCAL_KINEMATIC_PYTORCH_V1'),
        metadata: z.any().optional(),
      });

      const p = schema.safeParse(req.body);
      if (!p.success) {
        return res.status(400).json({ error: p.error.errors[0].message });
      }

      const userId = uid(req);
      const {
        characterId,
        title,
        preset,
        description,
        videoUrl,
        durationSec,
        fps,
        width,
        height,
        sha256,
        fileSize,
        modelUsed,
        metadata,
      } = p.data;

      // Verify character ownership
      const character = db.prepare('SELECT id, brandId FROM characters WHERE id=? AND ownerId=?').get(characterId, userId) as any;
      if (!character) {
        return res.status(404).json({ error: 'Character not found or not owned by user' });
      }

      // Verify video file exists on disk
      const videoFilename = path.basename(videoUrl);
      const videoPath = path.resolve('./data/storage/videos', videoFilename);
      if (!fs.existsSync(videoPath)) {
        return res.status(400).json({ error: 'Referenced animation video file does not exist on disk' });
      }

      // Verify SHA-256 match
      const diskSha = computeFileSha256(videoPath);
      if (diskSha !== sha256) {
        return res.status(400).json({ error: 'SHA-256 digest mismatch with disk video asset' });
      }

      const info = db.prepare(`
        INSERT INTO character_animations (
          ownerId, brandId, characterId, title, preset, description,
          durationSec, fps, width, height, videoUrl, thumbnailUrl,
          sha256, fileSize, modelUsed, metadata, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        userId,
        character.brandId,
        character.id,
        title,
        preset,
        description || '',
        durationSec,
        fps,
        width,
        height,
        videoUrl,
        '',
        sha256,
        fileSize,
        modelUsed,
        JSON.stringify(metadata || {})
      );

      const savedRow = db.prepare('SELECT * FROM character_animations WHERE id=?').get(info.lastInsertRowid) as any;
      res.status(201).json({ ok: true, animation: savedRow });
    } catch (err: any) {
      console.error('[MotionStudio] Save error:', err);
      res.status(500).json({ error: err.message || 'Failed to save animation asset' });
    }
  });

  // 4. List saved animations
  router.get('/animations', (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const characterId = req.query.characterId ? Number(req.query.characterId) : null;

      let query = 'SELECT * FROM character_animations WHERE ownerId=?';
      const params: any[] = [userId];

      if (characterId) {
        query += ' AND characterId=?';
        params.push(characterId);
      }
      query += ' ORDER BY id DESC';

      const rows = db.prepare(query).all(...params) as any[];
      res.json({ ok: true, animations: rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch animations' });
    }
  });

  // 5. Get specific saved animation
  router.get('/animations/:id', (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const row = db.prepare('SELECT * FROM character_animations WHERE id=? AND ownerId=?').get(req.params.id, userId) as any;
      if (!row) {
        return res.status(404).json({ error: 'Animation not found' });
      }
      res.json({ ok: true, animation: row });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch animation' });
    }
  });

  // 6. Delete saved animation
  router.delete('/animations/:id', (req: Request, res: Response) => {
    try {
      const userId = uid(req);
      const row = db.prepare('SELECT * FROM character_animations WHERE id=? AND ownerId=?').get(req.params.id, userId) as any;
      if (!row) {
        return res.status(404).json({ error: 'Animation not found' });
      }

      // Optionally unlink local file
      if (row.videoUrl) {
        const fPath = path.resolve('./data/storage/videos', path.basename(row.videoUrl));
        if (fs.existsSync(fPath)) {
          try { fs.unlinkSync(fPath); } catch (_) {}
        }
      }

      db.prepare('DELETE FROM character_animations WHERE id=? AND ownerId=?').run(req.params.id, userId);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete animation' });
    }
  });

  return router;
}

