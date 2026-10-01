import type { Request, Response, Router } from 'express';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { uid } from './crud.js';
import type { DB } from './db.js';
import { LocalImageProvider } from './providers/image.js';
import { LocalLLMProvider } from './providers/llm.js';
import { OriginalityEngine } from './providers/originality.js';
import { QualityGateEngine } from './providers/quality_gate.js';
import { PlatformAdaptationEngine } from './providers/platform_adaptation.js';
import { LocalTTSProvider } from './providers/tts.js';
import type { BrandContext } from './providers/types.js';
import { FFmpegVideoProvider, generateSrtContent } from './providers/video.js';
import { AIDanceMotionProvider } from './providers/dance_motion.js';
import { NeuralDanceProvider } from './providers/neural_dance.js';

export const DANCER_ARCHETYPES = [
  {
    archetypeId: 'priya_desi',
    name: 'Priya "The Royal Desi Siren"',
    role: 'Bollywood & Indo-Classical Fusion',
    region: 'South Asian / Indian',
    regionFlag: '🇮🇳',
    age: 23,
    personality: 'Graceful, seductive, expressive eye movements, regal presence',
    appearance: 'Striking sculpted Indian features, captivating kohl-lined dark almond eyes, radiant warm golden skin, sleek dark wavy hair with maang tikka',
    clothingStyle: 'Embellished royal peacock-blue silk and gold embroidered stage corset with matching lehenga skirt and delicate jhumka earrings',
    visualPrompt: 'Chiaroscuro palace stage lighting, warm golden rim reflections, silk fabric ripples, cinematic Bollywood drama, 8k vertical',
    voiceStyle: 'Samantha',
    tagline: 'Regal Indian classical allure & expressive emotional mastery',
    avatarEmoji: '🪷',
    accentColor: '#3b82f6',
    portraitUrl: '/api/media/images/priya_portrait.jpg',
  },
  {
    archetypeId: 'elena_crimson',
    name: 'Elena "The Crimson Siren"',
    role: 'Flamenco & Latin Tango Soloist',
    region: 'Latina / Hispanic',
    regionFlag: '🇪🇸',
    age: 24,
    personality: 'Sensual, fierce, poised, magnetic eye contact',
    appearance: 'Striking sculpted Latin facial features, intense deep hazel eyes, dark voluminous wavy hair, athletic silhouette',
    clothingStyle: 'Midnight crimson liquid silk high-slit gown with gold accents and dramatic fabric movement',
    visualPrompt: 'High-contrast stage lighting, dramatic backlights, liquid silk ripples, golden haze, intense camera focus on eyes and posture',
    voiceStyle: 'Samantha',
    tagline: 'Passionate rhythm & intoxicating stage presence',
    avatarEmoji: '💃',
    accentColor: '#e11d48',
    portraitUrl: '/api/media/images/elena_portrait.jpg',
  },
  {
    archetypeId: 'mei_kpop',
    name: 'Mei "The Neon K-Pop Muse"',
    role: 'K-Pop Stage & High-Heels Soloist',
    region: 'East Asian',
    regionFlag: '🇯🇵',
    age: 22,
    personality: 'Fierce, captivating, sharp modern glamour, intense eye contact',
    appearance: 'Luminous porcelain complexion, captivating winged cat-eyes, glossy gradient lips, sleek jet-black bob haircut',
    clothingStyle: 'Futuristic metallic lavender and chrome stage corset top with matching high-waisted shorts and thigh-high boots',
    visualPrompt: 'Electric neon cyan and violet stage rim lighting, futuristic stage bokeh, high-energy sharp choreography hits, 8k vertical',
    voiceStyle: 'Moira',
    tagline: 'High-energy futuristic glamour & razor-sharp precision',
    avatarEmoji: '💜',
    accentColor: '#a855f7',
    portraitUrl: '/api/media/images/mei_portrait.jpg',
  },
  {
    archetypeId: 'maya_mystic',
    name: 'Maya "The Shadow Mystic"',
    role: 'Oriental Belly-Fusion & Contemporary',
    region: 'Middle Eastern / Arab',
    regionFlag: '🇦🇪',
    age: 25,
    personality: 'Enigmatic, hypnotic, serene, intense artistic focus',
    appearance: 'Exotic graceful bone structure, piercing almond amber eyes, waist-length braided dark hair with gold cuffs',
    clothingStyle: 'Flowing emerald green silk skirt, structured velvet bodice, delicate antique gold arm cuffs and temple jewelry',
    visualPrompt: 'Violet and emerald neon rim-lighting, stage fog, glossy black reflective floor, fluid body isolations',
    voiceStyle: 'Karen',
    tagline: 'Hypnotic fluid isolations & mystical stage aura',
    avatarEmoji: '🔮',
    accentColor: '#10b981',
    portraitUrl: '/api/media/images/maya_portrait.jpg',
  },
  {
    archetypeId: 'aria_diva',
    name: 'Aria "The Golden Diva"',
    role: 'Cabaret & Broadway Star',
    region: 'Western / American',
    regionFlag: '🇺🇸',
    age: 23,
    personality: 'Playful, confident, ultra-glamorous, seductive smile',
    appearance: 'High cheekbones, luminous golden complexion, warm sparkling eyes, vintage Hollywood platinum-blonde waves',
    clothingStyle: 'Embellished gold crystal fringe corset, sheer satin opera gloves, statement crystal earrings',
    visualPrompt: 'Warm amber spotlights, glittering crystal reflections, cinematic cabaret stage bokeh, slow-motion choreography',
    voiceStyle: 'Victoria',
    tagline: 'High-fashion allure & vintage Broadway glamour',
    avatarEmoji: '✨',
    accentColor: '#f59e0b',
    portraitUrl: '/api/media/images/aria_portrait.jpg',
  },
  {
    archetypeId: 'amara_afro',
    name: 'Amara "The Afro-Goddess Soloist"',
    role: 'Afro-Fusion & Royal Stage Soloist',
    region: 'African / Afro-Diaspora',
    regionFlag: '🇳🇬',
    age: 24,
    personality: 'Commanding, joyful, regal, magnetic stage presence',
    appearance: 'Radiant deep melanin complexion, high sculpted cheekbones, intense dark eyes, intricate cornrow braids crowned with polished gold cuffs',
    clothingStyle: 'Vibrant rich magenta satin and gold filigree stage bodice with matching flowing skirt and gold jewelry',
    visualPrompt: 'Dramatic golden stage rim lighting, vibrant purple and gold bokeh, powerful fluid stage movement, 8k vertical',
    voiceStyle: 'Victoria',
    tagline: 'Royal melanin beauty & intoxicating rhythmic power',
    avatarEmoji: '👑',
    accentColor: '#ec4899',
    portraitUrl: '/api/media/images/amara_portrait.jpg',
  },
  {
    archetypeId: 'zara_temptress',
    name: 'Zara "The Urban Temptress"',
    role: 'Commercial Stage & High-Heels Soloist',
    region: 'European / Modern Stage',
    regionFlag: '🇪🇺',
    age: 22,
    personality: 'Bold, commanding, fearless, sharp modern attitude',
    appearance: 'Sharp angular jawline, sultry cat-eye makeup, sleek high ponytail, powerful sculpted stage presence',
    clothingStyle: 'Glossy black leather & chrome corset top, tailored satin track trousers, 4-inch stage heels',
    visualPrompt: 'Strobe light flashes, neon cyan and magenta rim light, fast-cut cinematic camera angles, razor-sharp rhythm hits',
    voiceStyle: 'Moira',
    tagline: 'Razor-sharp choreography & modern fierce energy',
    avatarEmoji: '⚡',
    accentColor: '#8b5cf6',
    portraitUrl: '/api/media/images/zara_portrait.jpg',
  },
];

export function createContentEngineRouter(db: DB): Router {
  const router = express.Router();

  const llm = new LocalLLMProvider();
  const tts = new LocalTTSProvider();
  const imageProvider = new LocalImageProvider();
  const videoProvider = new FFmpegVideoProvider();

  // Dancer Archetypes API
  router.get('/characters/archetypes', (_req: Request, res: Response) => {
    res.json(DANCER_ARCHETYPES);
  });

  // Generate / Preview Live Custom Character Portrait
  router.post('/characters/preview-portrait', async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        name: z.string().default('Virtual Dancer'),
        appearance: z.string(),
        clothingStyle: z.string(),
        visualPrompt: z.string().optional(),
      });
      const p = schema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.errors[0].message });

      const imgDir = path.resolve('./data/storage/images');
      fs.mkdirSync(imgDir, { recursive: true });

      const filename = `custom_portrait_${Date.now()}.png`;
      const targetFile = path.join(imgDir, filename);

      const prompt = `Close-up face portrait of ${p.data.name}, ${p.data.appearance}, wearing ${p.data.clothingStyle}. ${p.data.visualPrompt || 'Dramatic stage lighting, golden rim accents, highly detailed, 8k vertical composition'}`;
      
      const { filePath } = await imageProvider.generateSceneImage(
        prompt,
        'Dramatic stage lighting, high-contrast, cinematic glamour',
        targetFile,
        `PORTRAIT: ${p.data.name.toUpperCase()}`,
        p.data.appearance
      );

      res.json({
        ok: true,
        portraitUrl: `/api/media/images/${filename}`,
        prompt,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate portrait preview' });
    }
  });

  // Adopt a Dancer Archetype for Brand
  router.post('/characters/archetypes/adopt', (req: Request, res: Response) => {
    try {
      const schema = z.object({
        brandId: z.number().int(),
        archetypeId: z.string(),
      });
      const p = schema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.errors[0].message });

      const userId = uid(req);
      const brand = db.prepare('SELECT * FROM brands WHERE id=? AND ownerId=?').get(p.data.brandId, userId) as any;
      if (!brand) return res.status(404).json({ error: 'Brand not found' });

      const arc = DANCER_ARCHETYPES.find((a) => a.archetypeId === p.data.archetypeId);
      if (!arc) return res.status(404).json({ error: 'Archetype not found' });

      const existing = db.prepare('SELECT * FROM characters WHERE brandId=? AND ownerId=? AND name=?').get(brand.id, userId, arc.name) as any;
      if (existing) {
        return res.json({ ok: true, character: existing, alreadyAdopted: true });
      }

      const row = db.prepare(`
        INSERT INTO characters(ownerId, brandId, name, description, age, personality, appearance, clothingStyle, visualPrompt, negativePrompt, voiceStyle)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        brand.id,
        arc.name,
        `${arc.role} — ${arc.tagline}`,
        arc.age,
        arc.personality,
        arc.appearance,
        arc.clothingStyle,
        arc.visualPrompt,
        'nudity, deformed, bad anatomy, blur, low quality, distortion',
        arc.voiceStyle
      );

      const created = db.prepare('SELECT * FROM characters WHERE id=?').get(row.lastInsertRowid);
      res.status(201).json({ ok: true, character: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to adopt archetype' });
    }
  });

  const getBrandContext = (brandId: number, userId: number): BrandContext => {
    const brand = db.prepare('SELECT * FROM brands WHERE id=? AND ownerId=?').get(brandId, userId) as any;
    if (!brand) throw new Error('Brand not found');

    let audienceProfile: any;
    if (brand.audienceProfileId) {
      audienceProfile = db.prepare('SELECT * FROM audience_profiles WHERE id=? AND ownerId=?').get(brand.audienceProfileId, userId);
    }

    const safeJson = (val: any) => {
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return []; }
      }
      return Array.isArray(val) ? val : [];
    };

    return {
      id: brand.id,
      name: brand.name,
      handle: brand.handle,
      niche: brand.niche,
      tone: brand.tone,
      language: brand.language,
      targetAgeMin: brand.targetAgeMin,
      targetAgeMax: brand.targetAgeMax,
      targetGender: brand.targetGender,
      preferredTopics: safeJson(brand.preferredTopics),
      prohibitedTopics: safeJson(brand.prohibitedTopics),
      visualStyle: brand.visualStyle,
      contentRules: brand.contentRules,
      audienceProfile: audienceProfile ? {
        name: audienceProfile.name,
        interests: safeJson(audienceProfile.interests),
        avoid: safeJson(audienceProfile.avoid),
        tone: audienceProfile.tone,
        preferredDurationSec: audienceProfile.preferredDurationSec,
      } : undefined,
    };
  };

  // Generate Ideas for Brand
  router.post('/ideas/generate', async (req: Request, res: Response) => {
    try {
      const schema = z.object({ brandId: z.number().int(), count: z.number().int().min(1).max(10).optional().default(5) });
      const p = schema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.errors[0].message });

      const userId = uid(req);
      const brand = getBrandContext(p.data.brandId, userId);

      // Fetch historical fingerprints to check originality
      const history = db.prepare('SELECT title, premise FROM originality_fingerprints WHERE brandId=? AND ownerId=?').all(p.data.brandId, userId) as Array<{ title: string; premise: string }>;

      const rawIdeas = await llm.generateIdeas(brand, p.data.count);
      const savedIdeas: any[] = [];

      for (const idea of rawIdeas) {
        const origCheck = OriginalityEngine.evaluateAgainstHistory(idea.title, idea.premise, history);
        const finalOriginalityScore = Math.min(idea.originalityScore, origCheck.score);

        const row = db.prepare(`
          INSERT INTO content_ideas(ownerId, brandId, title, premise, category, potentialScore, originalityScore, visualPotentialScore, difficulty, status, audienceFit, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          brand.id,
          idea.title,
          idea.premise,
          idea.category,
          idea.potentialScore,
          finalOriginalityScore,
          idea.visualPotentialScore,
          idea.difficulty,
          'DISCOVERED',
          idea.audienceFit,
          JSON.stringify(idea.tags)
        );

        savedIdeas.push({
          id: row.lastInsertRowid,
          ...idea,
          originalityScore: finalOriginalityScore,
          repetitionWarning: origCheck.warning,
          status: 'DISCOVERED',
        });
      }

      res.status(201).json(savedIdeas);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate ideas' });
    }
  });

  // Get Ideas
  router.get('/ideas', (req: Request, res: Response) => {
    const userId = uid(req);
    const brandId = req.query.brandId ? Number(req.query.brandId) : null;
    let query = 'SELECT * FROM content_ideas WHERE ownerId=?';
    const params: any[] = [userId];

    if (brandId) {
      query += ' AND brandId=?';
      params.push(brandId);
    }
    query += ' ORDER BY id DESC LIMIT 50';

    const rows = db.prepare(query).all(...params) as any[];
    const parsed = rows.map((r) => ({
      ...r,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : [],
    }));
    res.json(parsed);
  });

  // Accept Idea -> Create Content Item + Script + Scenes
  router.post('/ideas/:id/accept', async (req: Request, res: Response) => {
    try {
      const ideaId = Number(req.params.id);
      const userId = uid(req);
      const characterId = req.body?.characterId ? Number(req.body.characterId) : null;

      const idea = db.prepare('SELECT * FROM content_ideas WHERE id=? AND ownerId=?').get(ideaId, userId) as any;
      if (!idea) return res.status(404).json({ error: 'Idea not found' });

      const brand = getBrandContext(idea.brandId, userId);
      const char = characterId ? (db.prepare('SELECT * FROM characters WHERE id=? AND ownerId=?').get(characterId, userId) as any) : null;

      // 1. Create content item
      const itemRes = db.prepare(`
        INSERT INTO content_items(ownerId, brandId, title, topic, status, aiGenerated)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(userId, brand.id, idea.title, idea.category, 'DRAFT');
      const contentItemId = itemRes.lastInsertRowid as number;

      // 2. Generate 5-scene story & script
      const story = await llm.generateStory(brand, idea.title, idea.premise, char || undefined);

      const scriptRes = db.prepare(`
        INSERT INTO scripts(ownerId, contentItemId, brandId, title, hook, premise, targetDurationSec, language, tone, endingType)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, contentItemId, brand.id, story.title, story.hook, story.premise, story.targetDurationSec, story.language, story.tone, story.endingType);
      const scriptId = scriptRes.lastInsertRowid as number;

      // 3. Insert Scenes
      for (const sc of story.scenes) {
        db.prepare(`
          INSERT INTO scenes(scriptId, sceneOrder, durationSec, narration, dialogue, visualPrompt, voiceDirection, soundEffects, musicDirection, endingType)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(scriptId, sc.sceneOrder, sc.durationSec, sc.narration, sc.dialogue || null, sc.visualPrompt, sc.voiceDirection, sc.soundEffects || null, sc.musicDirection || null, sc.endingType || null);
      }

      // 4. Save originality fingerprint
      db.prepare(`
        INSERT INTO originality_fingerprints(ownerId, brandId, contentItemId, fingerprint, title, premise)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, brand.id, contentItemId, `${idea.title} ${idea.premise}`, idea.title, idea.premise);

      // 5. Update idea status
      db.prepare('UPDATE content_ideas SET status=? WHERE id=?').run('APPROVED', ideaId);

      res.status(201).json({ contentItemId, scriptId, story });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to accept idea' });
    }
  });

  // Create Custom Story from User's Prompt/Premise
  router.post('/content/custom', async (req: Request, res: Response) => {
    try {
      const schema = z.object({
        brandId: z.number().int(),
        characterId: z.number().int().optional().nullable(),
        title: z.string().min(1).max(200),
        premise: z.string().min(1).max(2000),
        customScenes: z.array(z.object({
          sceneOrder: z.number().int(),
          durationSec: z.number().int().default(8),
          narration: z.string(),
          visualPrompt: z.string(),
          voiceDirection: z.string().optional(),
          endingType: z.string().optional(),
        })).optional(),
      });

      const p = schema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.errors[0].message });

      const userId = uid(req);
      const brand = getBrandContext(p.data.brandId, userId);
      const char = p.data.characterId
        ? (db.prepare('SELECT * FROM characters WHERE id=? AND ownerId=?').get(p.data.characterId, userId) as any)
        : null;

      // 1. Create content item
      const itemRes = db.prepare(`
        INSERT INTO content_items(ownerId, brandId, title, topic, status, aiGenerated)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(userId, brand.id, p.data.title, 'Custom Story', 'DRAFT');
      const contentItemId = itemRes.lastInsertRowid as number;

      // 2. Generate or use custom scenes
      let story: any;
      if (p.data.customScenes && p.data.customScenes.length > 0) {
        const totalDuration = p.data.customScenes.reduce((acc, s) => acc + s.durationSec, 0);
        story = {
          title: p.data.title,
          hook: p.data.customScenes[0].narration,
          premise: p.data.premise,
          targetDurationSec: totalDuration,
          language: brand.language || 'English',
          tone: brand.tone || 'custom',
          endingType: 'Custom CTA',
          scenes: p.data.customScenes,
        };
      } else {
        story = await llm.generateStory(brand, p.data.title, p.data.premise, char || undefined);
      }

      const scriptRes = db.prepare(`
        INSERT INTO scripts(ownerId, contentItemId, brandId, title, hook, premise, targetDurationSec, language, tone, endingType)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, contentItemId, brand.id, story.title, story.hook, story.premise, story.targetDurationSec, story.language, story.tone, story.endingType);
      const scriptId = scriptRes.lastInsertRowid as number;

      for (const sc of story.scenes) {
        db.prepare(`
          INSERT INTO scenes(scriptId, sceneOrder, durationSec, narration, dialogue, visualPrompt, voiceDirection, soundEffects, musicDirection, endingType)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(scriptId, sc.sceneOrder, sc.durationSec, sc.narration, null, sc.visualPrompt, sc.voiceDirection || 'Confident, clear, engaging', null, null, sc.endingType || null);
      }

      // Save fingerprint
      db.prepare(`
        INSERT INTO originality_fingerprints(ownerId, brandId, contentItemId, fingerprint, title, premise)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, brand.id, contentItemId, `${p.data.title} ${p.data.premise}`, p.data.title, p.data.premise);

      res.status(201).json({ contentItemId, scriptId, story });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to create custom story' });
    }
  });

  // Edit Scene
  router.patch('/scenes/:id', (req: Request, res: Response) => {
    const sceneId = Number(req.params.id);
    const schema = z.object({
      narration: z.string().optional(),
      visualPrompt: z.string().optional(),
      durationSec: z.number().int().min(1).max(60).optional(),
      voiceDirection: z.string().optional(),
    });
    const p = schema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.errors[0].message });

    const scene = db.prepare('SELECT * FROM scenes WHERE id=?').get(sceneId) as any;
    if (!scene) return res.status(404).json({ error: 'Scene not found' });

    const fields: string[] = [];
    const vals: any[] = [];
    if (p.data.narration !== undefined) { fields.push('narration=?'); vals.push(p.data.narration); }
    if (p.data.visualPrompt !== undefined) { fields.push('visualPrompt=?'); vals.push(p.data.visualPrompt); }
    if (p.data.durationSec !== undefined) { fields.push('durationSec=?'); vals.push(p.data.durationSec); }
    if (p.data.voiceDirection !== undefined) { fields.push('voiceDirection=?'); vals.push(p.data.voiceDirection); }

    if (fields.length > 0) {
      vals.push(sceneId);
      db.prepare(`UPDATE scenes SET ${fields.join(', ')} WHERE id=?`).run(...vals);
    }

    res.json({ ok: true });
  });

  // Get full content item details (script, scenes, assets, originality)
  router.get('/content/:id/full', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const userId = uid(req);

    const item = db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(id, userId) as any;
    if (!item) return res.status(404).json({ error: 'Content item not found' });

    const brand = db.prepare('SELECT id, name, handle, tone, niche FROM brands WHERE id=?').get(item.brandId) as any;
    const script = db.prepare('SELECT * FROM scripts WHERE contentItemId=?').get(id) as any;
    const scenes = script ? db.prepare('SELECT * FROM scenes WHERE scriptId=? ORDER BY sceneOrder ASC').all(script.id) : [];
    const assets = db.prepare('SELECT * FROM assets WHERE contentItemId=? ORDER BY id ASC').all(id) as any[];

    const history = db.prepare('SELECT title, premise FROM originality_fingerprints WHERE brandId=? AND contentItemId!=?').all(item.brandId, id) as any[];
    const originalityReport = script ? OriginalityEngine.evaluateAgainstHistory(script.title, script.premise, history) : null;

    res.json({
      ...item,
      brand,
      script,
      scenes,
      assets,
      originalityReport,
    });
  });

  // Attach AI-Generated or Uploaded Video Clip to a Scene Beat
  router.post('/content/:id/scenes/:sceneId/attach-video', async (req: Request, res: Response) => {
    try {
      const contentItemId = Number(req.params.id);
      const sceneId = Number(req.params.sceneId);
      const userId = uid(req);

      const schema = z.object({
        videoBase64: z.string().optional(),
        videoUrl: z.string().optional(),
      });
      const p = schema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.errors[0].message });

      const targetDir = path.resolve('./data/storage/videos');
      fs.mkdirSync(targetDir, { recursive: true });

      const outFile = path.join(targetDir, `clip_${contentItemId}_${sceneId}_${Date.now()}.mp4`);

      if (p.data.videoUrl) {
        const resp = await fetch(p.data.videoUrl);
        if (!resp.ok) throw new Error(`Failed to download video from URL (HTTP ${resp.status})`);
        const buf = await resp.arrayBuffer();
        fs.writeFileSync(outFile, Buffer.from(buf));
      } else if (p.data.videoBase64) {
        const cleanB64 = p.data.videoBase64.replace(/^data:video\/[a-zA-Z0-9]+;base64,/, '');
        fs.writeFileSync(outFile, Buffer.from(cleanB64, 'base64'));
      } else {
        return res.status(400).json({ error: 'Either videoBase64 or videoUrl must be provided' });
      }

      // Record in assets
      db.prepare("DELETE FROM assets WHERE contentItemId=? AND sceneId=? AND type='SCENE_VIDEO'").run(contentItemId, sceneId);
      db.prepare(`
        INSERT INTO assets(ownerId, contentItemId, sceneId, type, provider, filePath, mimeType)
        VALUES (?, ?, ?, 'SCENE_VIDEO', 'AIGenerated/Upload', ?, 'video/mp4')
      `).run(userId, contentItemId, sceneId, outFile);

      res.status(201).json({ ok: true, filePath: outFile });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to attach video clip' });
    }
  });

  // 1-Click Auto Animate a Single Scene Beat
  router.post('/content/:id/scenes/:sceneId/auto-animate', async (req: Request, res: Response) => {
    try {
      const contentItemId = Number(req.params.id);
      const sceneId = Number(req.params.sceneId);
      const userId = uid(req);

      const scene = db.prepare('SELECT * FROM scenes WHERE id=?').get(sceneId) as any;
      if (!scene) return res.status(404).json({ error: 'Scene not found' });

      const targetDir = path.resolve('./data/storage/videos');
      fs.mkdirSync(targetDir, { recursive: true });
      const outFile = path.join(targetDir, `clip_${contentItemId}_${sceneId}_${Date.now()}.mp4`);

      // Find scene's visual or fallback to character portrait
      const imgAsset = (db.prepare("SELECT * FROM assets WHERE contentItemId=? AND type='IMAGE' AND sceneId=? ORDER BY id DESC").get(contentItemId, sceneId)
        || db.prepare("SELECT * FROM assets WHERE contentItemId=? AND type='IMAGE' ORDER BY id DESC").get(contentItemId)) as any;
      const portraitPath = imgAsset?.filePath && fs.existsSync(imgAsset.filePath)
        ? imgAsset.filePath
        : path.resolve('./data/storage/images/rhea_bralette_portrait.jpg');

      const danceProvider = new AIDanceMotionProvider();
      await danceProvider.generateDanceClip({
        sceneOrder: scene.sceneOrder || 1,
        durationSec: scene.durationSec || 9,
        portraitPath,
        choreographyType: scene.endingType || 'DANCE',
        outputPath: outFile,
      });

      // Record in assets
      db.prepare("DELETE FROM assets WHERE contentItemId=? AND sceneId=? AND type='SCENE_VIDEO'").run(contentItemId, sceneId);
      db.prepare(`
        INSERT INTO assets(ownerId, contentItemId, sceneId, type, provider, filePath, mimeType)
        VALUES (?, ?, ?, 'SCENE_VIDEO', 'AIDanceEngine/Auto', ?, 'video/mp4')
      `).run(userId, contentItemId, sceneId, outFile);

      res.status(200).json({ ok: true, filePath: outFile });
    } catch (err: any) {
      console.error('Auto animate error:', err);
      res.status(500).json({ error: err.message || 'Failed to auto-animate scene' });
    }
  });

  // 1-Click Auto Animate All Scenes for a Video Project
  router.post('/content/:id/auto-animate-all', async (req: Request, res: Response) => {
    try {
      const contentItemId = Number(req.params.id);
      const userId = uid(req);

      const script = db.prepare('SELECT * FROM scripts WHERE contentItemId=?').get(contentItemId) as any;
      if (!script) return res.status(400).json({ error: 'No script found for this video' });

      const scenes = db.prepare('SELECT * FROM scenes WHERE scriptId=? ORDER BY sceneOrder ASC').all(script.id) as any[];
      const targetDir = path.resolve('./data/storage/videos');
      fs.mkdirSync(targetDir, { recursive: true });

      const danceProvider = new AIDanceMotionProvider();
      const results = [];

      for (const sc of scenes) {
        const outFile = path.join(targetDir, `clip_${contentItemId}_${sc.id}_${Date.now()}.mp4`);
        const imgAsset = (db.prepare("SELECT * FROM assets WHERE contentItemId=? AND type='IMAGE' AND sceneId=? ORDER BY id DESC").get(contentItemId, sc.id)
          || db.prepare("SELECT * FROM assets WHERE contentItemId=? AND type='IMAGE' ORDER BY id DESC").get(contentItemId)) as any;
        const portraitPath = imgAsset?.filePath && fs.existsSync(imgAsset.filePath)
          ? imgAsset.filePath
          : path.resolve('./data/storage/images/rhea_bralette_portrait.jpg');

        await danceProvider.generateDanceClip({
          sceneOrder: sc.sceneOrder || 1,
          durationSec: sc.durationSec || 9,
          portraitPath,
          choreographyType: sc.endingType || 'DANCE',
          outputPath: outFile,
        });

        db.prepare("DELETE FROM assets WHERE contentItemId=? AND sceneId=? AND type='SCENE_VIDEO'").run(contentItemId, sc.id);
        db.prepare(`
          INSERT INTO assets(ownerId, contentItemId, sceneId, type, provider, filePath, mimeType)
          VALUES (?, ?, ?, 'SCENE_VIDEO', 'AIDanceEngine/Auto', ?, 'video/mp4')
        `).run(userId, contentItemId, sc.id, outFile);

        results.push({ sceneId: sc.id, filePath: outFile });
      }

      res.status(200).json({ ok: true, count: results.length, results });
    } catch (err: any) {
      console.error('Auto animate all error:', err);
      res.status(500).json({ error: err.message || 'Failed to auto-animate all scenes' });
    }
  });

  const NEURAL_CONFIG_FILE = path.resolve('./data/neural_config.json');
  const getNeuralConfig = () => {
    try {
      if (fs.existsSync(NEURAL_CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(NEURAL_CONFIG_FILE, 'utf8'));
      }
    } catch {}
    return {
      gpuServerUrl: process.env.NEURAL_DANCE_GPU_URL || '',
      apiProvider: 'COLAB_GPU',
      apiKey: '',
    };
  };

  const saveNeuralConfig = (config: any) => {
    fs.mkdirSync(path.dirname(NEURAL_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(NEURAL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  };

  router.get('/settings/neural-dance-config', (_req: Request, res: Response) => {
    res.json(getNeuralConfig());
  });

  router.post('/settings/neural-dance-config', (req: Request, res: Response) => {
    const p = req.body;
    saveNeuralConfig({
      gpuServerUrl: p.gpuServerUrl || '',
      apiProvider: p.apiProvider || 'COLAB_GPU',
      apiKey: p.apiKey || '',
    });
    res.json({ ok: true });
  });

  // Neural Diffusion Video Generation (MimicMotion / LivePortrait / Cloud GPU)
  router.post('/content/:id/scenes/:sceneId/neural-dance-generate', async (req: Request, res: Response) => {
    try {
      const contentItemId = Number(req.params.id);
      const sceneId = Number(req.params.sceneId);
      const userId = uid(req);

      const scene = db.prepare('SELECT * FROM scenes WHERE id=?').get(sceneId) as any;
      if (!scene) return res.status(404).json({ error: 'Scene not found' });

      const targetDir = path.resolve('./data/storage/videos');
      fs.mkdirSync(targetDir, { recursive: true });
      const outFile = path.join(targetDir, `neural_clip_${contentItemId}_${sceneId}_${Date.now()}.mp4`);

      const imgAsset = (db.prepare("SELECT * FROM assets WHERE contentItemId=? AND type='IMAGE' AND sceneId=? ORDER BY id DESC").get(contentItemId, sceneId)
        || db.prepare("SELECT * FROM assets WHERE contentItemId=? AND type='IMAGE' ORDER BY id DESC").get(contentItemId)) as any;
      const portraitPath = imgAsset?.filePath && fs.existsSync(imgAsset.filePath)
        ? imgAsset.filePath
        : path.resolve('./data/storage/images/rhea_bralette_portrait.jpg');

      const config = getNeuralConfig();
      const neuralProvider = new NeuralDanceProvider();

      const { filePath, providerUsed } = await neuralProvider.generateNeuralDanceVideo({
        sceneOrder: scene.sceneOrder || 1,
        durationSec: scene.durationSec || 5,
        portraitPath,
        visualPrompt: scene.visualPrompt || 'Bollywood expressive classical fusion dance in rain',
        outputPath: outFile,
        gpuServerUrl: config.gpuServerUrl,
        apiProvider: config.apiProvider,
        apiKey: config.apiKey,
      });

      db.prepare("DELETE FROM assets WHERE contentItemId=? AND sceneId=? AND type='SCENE_VIDEO'").run(contentItemId, sceneId);
      db.prepare(`
        INSERT INTO assets(ownerId, contentItemId, sceneId, type, provider, filePath, mimeType)
        VALUES (?, ?, ?, 'SCENE_VIDEO', ?, ?, 'video/mp4')
      `).run(userId, contentItemId, sceneId, providerUsed, outFile);

      res.status(200).json({ ok: true, filePath, providerUsed });
    } catch (err: any) {
      console.error('Neural dance generation error:', err);
      res.status(500).json({ error: err.message || 'Failed to generate neural dance video' });
    }
  });

  // Render Full Vertical 9:16 Video
  router.post('/content/:id/render', async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);

      const item = db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(id, userId) as any;
      if (!item) return res.status(404).json({ error: 'Content item not found' });

      const script = db.prepare('SELECT * FROM scripts WHERE contentItemId=?').get(id) as any;
      if (!script) return res.status(400).json({ error: 'No script found for this content item. Create a script first.' });

      const scenes = db.prepare('SELECT * FROM scenes WHERE scriptId=? ORDER BY sceneOrder ASC').all(script.id) as any[];
      if (scenes.length === 0) return res.status(400).json({ error: 'Script has no scenes.' });

      const brand = getBrandContext(item.brandId, userId);

      // Create storage directories
      const baseStorage = path.resolve('./data/storage');
      const imgDir = path.join(baseStorage, 'images');
      const audioDir = path.join(baseStorage, 'audio');
      const subDir = path.join(baseStorage, 'subtitles');
      const vidDir = path.join(baseStorage, 'videos');
      [imgDir, audioDir, subDir, vidDir].forEach((d) => fs.mkdirSync(d, { recursive: true }));

      // 1. Generate Voiceover Narration for each scene & concatenate full audio
      const fullNarration = scenes.map((s) => s.narration).join('. ');
      const mainAudioFile = path.join(audioDir, `narration_${id}_${Date.now()}.mp3`);
      const { filePath: audioPath } = await tts.synthesize(fullNarration, 'Samantha', mainAudioFile);

      db.prepare(`
        INSERT INTO assets(ownerId, contentItemId, type, provider, prompt, filePath, mimeType)
        VALUES (?, ?, 'AUDIO', 'LocalTTS', ?, ?, 'audio/mpeg')
      `).run(userId, id, fullNarration, audioPath);

      // 2. Generate Scene Images or Use Moving Dance Video Clips
      const renderedScenes: Array<{ imagePath?: string; videoClipPath?: string; narration: string; durationSec: number }> = [];

      // Find character portrait for this content item / brand
      let characterPortraitPath: string | undefined;
      const charCandidates = db.prepare('SELECT * FROM characters WHERE brandId=? AND ownerId=? ORDER BY id DESC').all(brand.id, userId) as any[];
      const fullContentText = `${item.title || ''} ${item.premise || ''} ${item.hook || ''} ${scenes.map(s => s.visualPrompt).join(' ')}`.toLowerCase();

      let matchedChar = charCandidates.find(c => fullContentText.includes(c.name.toLowerCase()));
      if (!matchedChar && charCandidates.length > 0) {
        matchedChar = charCandidates[0];
      }

      if (matchedChar) {
        const arc = DANCER_ARCHETYPES.find(a => a.name.toLowerCase() === matchedChar.name.toLowerCase());
        if (arc?.portraitUrl) {
          const filename = arc.portraitUrl.split('/').pop() || '';
          const arcPath = path.join(imgDir, filename);
          if (fs.existsSync(arcPath)) characterPortraitPath = arcPath;
        }
      }

      if (!characterPortraitPath) {
        if (fullContentText.includes('bralette') || fullContentText.includes('backless') || fullContentText.includes('monsoon') || fullContentText.includes('rhea')) {
          characterPortraitPath = path.join(imgDir, 'rhea_bralette_portrait.jpg');
        } else if (fullContentText.includes('priya') || fullContentText.includes('saree')) {
          characterPortraitPath = path.join(imgDir, 'priya_portrait.jpg');
        } else if (fullContentText.includes('elena') || fullContentText.includes('flamenco')) {
          characterPortraitPath = path.join(imgDir, 'elena_portrait.jpg');
        } else if (fullContentText.includes('mei') || fullContentText.includes('k-pop')) {
          characterPortraitPath = path.join(imgDir, 'mei_portrait.jpg');
        } else if (fullContentText.includes('maya') || fullContentText.includes('belly')) {
          characterPortraitPath = path.join(imgDir, 'maya_portrait.jpg');
        } else if (fullContentText.includes('aria')) {
          characterPortraitPath = path.join(imgDir, 'aria_portrait.jpg');
        } else if (fullContentText.includes('amara')) {
          characterPortraitPath = path.join(imgDir, 'amara_portrait.jpg');
        } else if (fullContentText.includes('zara')) {
          characterPortraitPath = path.join(imgDir, 'zara_portrait.jpg');
        }
      }

      // Multi-angle choreography progression across 5 scene beats
      const getScenePortraitPath = (sceneOrder: number): string | undefined => {
        if (fullContentText.includes('bralette') || fullContentText.includes('backless') || fullContentText.includes('monsoon') || fullContentText.includes('rhea')) {
          const poses = [
            path.join(imgDir, 'rhea_bralette_portrait.jpg'),
            path.join(imgDir, 'monsoon_rain_portrait.jpg'),
            path.join(imgDir, 'rhea_backless_portrait.jpg'),
            path.join(imgDir, 'custom_portrait_1790843021970.png'),
            path.join(imgDir, 'rhea_bralette_portrait.jpg'),
          ];
          const chosen = poses[(sceneOrder - 1) % poses.length];
          if (fs.existsSync(chosen)) return chosen;
        }
        return characterPortraitPath;
      };

      for (const sc of scenes) {
        const sceneVideoAsset = db.prepare("SELECT * FROM assets WHERE contentItemId=? AND sceneId=? AND type='SCENE_VIDEO'").get(id, sc.id) as any;
        let videoClipPath: string | undefined;
        let imgPath: string | undefined;

        if (sceneVideoAsset && fs.existsSync(sceneVideoAsset.filePath)) {
          videoClipPath = sceneVideoAsset.filePath;
        } else {
          const sceneImgFile = path.join(imgDir, `scene_${id}_${sc.sceneOrder}_${Date.now()}.png`);
          const scenePortrait = getScenePortraitPath(sc.sceneOrder);
          const { filePath: genImgPath } = await imageProvider.generateSceneImage(
            sc.visualPrompt,
            brand.visualStyle || 'cinematic',
            sceneImgFile,
            `BEAT ${sc.sceneOrder}: ${sc.endingType || 'DANCE'}`,
            sc.narration,
            scenePortrait
          );
          imgPath = genImgPath;

          db.prepare(`
            INSERT INTO assets(ownerId, contentItemId, sceneId, type, provider, prompt, filePath, mimeType)
            VALUES (?, ?, ?, 'IMAGE', 'LocalImageProvider', ?, ?, 'image/png')
          `).run(userId, id, sc.id, sc.visualPrompt, imgPath);
        }

        renderedScenes.push({
          imagePath: imgPath,
          videoClipPath: videoClipPath,
          narration: sc.narration,
          durationSec: sc.durationSec,
        });
      }

      // 3. Generate Subtitles
      const srtContent = generateSrtContent(renderedScenes);
      const srtFile = path.join(subDir, `subtitles_${id}.srt`);
      fs.writeFileSync(srtFile, srtContent, 'utf8');

      db.prepare(`
        INSERT INTO assets(ownerId, contentItemId, type, provider, filePath, mimeType)
        VALUES (?, ?, 'SUBTITLE', 'LocalSubtitles', ?, 'text/plain')
      `).run(userId, id, srtFile);

      // 4. Render Final 9:16 Video with FFmpeg
      const videoOutFile = path.join(vidDir, `short_${id}_master.mp4`);
      const { filePath: finalVideoPath, durationSec: totalDuration } = await videoProvider.renderShort({
        scenes: renderedScenes,
        audioTrackPath: audioPath,
        subtitlesSrtPath: srtFile,
        outputPath: videoOutFile,
        title: item.title,
      });

      db.prepare(`
        INSERT INTO assets(ownerId, contentItemId, type, provider, filePath, mimeType, metadata)
        VALUES (?, ?, 'VIDEO', 'FFmpeg', ?, 'video/mp4', ?)
      `).run(userId, id, finalVideoPath, JSON.stringify({ durationSec: totalDuration, resolution: '1080x1920', aspectRatio: '9:16' }));

      // 5. Update content item status to READY_FOR_REVIEW
      db.prepare("UPDATE content_items SET status='READY_FOR_REVIEW' WHERE id=?").run(id);

      res.json({
        ok: true,
        contentItemId: id,
        status: 'READY_FOR_REVIEW',
        videoPath: finalVideoPath,
        totalDuration,
      });
    } catch (err: any) {
      console.error('Render pipeline error:', err);
      res.status(500).json({ error: err.message || 'Rendering failed' });
    }
  });

  // Media Streaming Route
  router.get('/media/:type/:filename', (req: Request, res: Response) => {
    const { type, filename } = req.params;
    if (!['images', 'audio', 'videos', 'subtitles'].includes(type)) {
      return res.status(400).json({ error: 'Invalid media type' });
    }

    // Protect against path traversal
    const safeFilename = path.basename(filename);
    const filePath = path.resolve(`./data/storage/${type}/${safeFilename}`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const mimeMap: Record<string, string> = {
      images: 'image/png',
      audio: 'audio/mpeg',
      videos: 'video/mp4',
      subtitles: 'text/plain; charset=utf-8',
    };

    if (mimeMap[type]) {
      res.type(mimeMap[type]);
    }
    res.sendFile(filePath);
  });

  // Evaluate Quality Gate
  router.post('/content/:id/quality-gate', (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);

      const item = db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(id, userId) as any;
      if (!item) return res.status(404).json({ error: 'Content item not found' });

      const brand = getBrandContext(item.brandId, userId);
      const script = db.prepare('SELECT * FROM scripts WHERE contentItemId=?').get(id) as any;
      if (!script) return res.status(400).json({ error: 'Script missing' });

      const scenes = db.prepare('SELECT * FROM scenes WHERE scriptId=? ORDER BY sceneOrder ASC').all(script.id) as any[];
      const assets = db.prepare('SELECT * FROM assets WHERE contentItemId=?').all(id) as any[];
      const history = db.prepare('SELECT title, premise FROM originality_fingerprints WHERE brandId=? AND contentItemId!=?').all(item.brandId, id) as any[];

      const report = QualityGateEngine.evaluate({
        brand,
        script,
        scenes,
        assets,
        history,
      });

      db.prepare(`
        INSERT INTO quality_reports(contentItemId, passed, safetyScore, checksJson)
        VALUES (?, ?, ?, ?)
      `).run(id, report.passed ? 1 : 0, report.safetyScore, JSON.stringify(report.checks));

      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Quality Gate evaluation failed' });
    }
  });

  // Approve for Publish
  router.post('/content/:id/approve', (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);

      const item = db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(id, userId) as any;
      if (!item) return res.status(404).json({ error: 'Content item not found' });

      // Run quality gate verification before approving
      const brand = getBrandContext(item.brandId, userId);
      const script = db.prepare('SELECT * FROM scripts WHERE contentItemId=?').get(id) as any;
      const scenes = script ? db.prepare('SELECT * FROM scenes WHERE scriptId=? ORDER BY sceneOrder ASC').all(script.id) as any[] : [];
      const assets = db.prepare('SELECT * FROM assets WHERE contentItemId=?').all(id) as any[];
      const history = db.prepare('SELECT title, premise FROM originality_fingerprints WHERE brandId=? AND contentItemId!=?').all(item.brandId, id) as any[];

      if (script && scenes.length > 0) {
        const qg = QualityGateEngine.evaluate({ brand, script, scenes, assets, history });
        if (!qg.canPublish) {
          return res.status(400).json({ error: 'Cannot approve: Quality Gate checks failed.', qualityReport: qg });
        }
      }

      db.prepare("UPDATE content_items SET status='APPROVED_FOR_PUBLISH' WHERE id=?").run(id);
      res.json({ ok: true, status: 'APPROVED_FOR_PUBLISH' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Approval failed' });
    }
  });

  // Reject Content
  router.post('/content/:id/reject', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const userId = uid(req);
    const item = db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(id, userId);
    if (!item) return res.status(404).json({ error: 'Content item not found' });

    db.prepare("UPDATE content_items SET status='REJECTED' WHERE id=?").run(id);
    res.json({ ok: true, status: 'REJECTED' });
  });

  // Regenerate Single Scene with AI
  router.post('/content/:id/regenerate-scene', async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);
      const schema = z.object({ sceneId: z.number().int() });
      const p = schema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.errors[0].message });

      const item = db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(id, userId) as any;
      if (!item) return res.status(404).json({ error: 'Content item not found' });

      const scene = db.prepare('SELECT * FROM scenes WHERE id=?').get(p.data.sceneId) as any;
      if (!scene) return res.status(404).json({ error: 'Scene not found' });

      const brand = getBrandContext(item.brandId, userId);
      const variations = [
        { narration: `In a breathtaking burst of tempo, the performer executes a sudden spin, capturing the golden ambient glow.`, prompt: `Vertical 9:16, dynamic high-speed pirouette, glowing amber lighting, theatrical dust particles, cinematic 8k aesthetic.` },
        { narration: `The stage plunges into deep violet silhouette, leaving only the sound of rhythm and velvet footsteps.`, prompt: `Vertical 9:16, deep violet and cobalt stage silhouette, rim lit contours, high-contrast atmospheric mystery.` },
        { narration: `With effortless precision, every subtle hand motion mirrors the orchestra crescendo in the background.`, prompt: `Vertical 9:16, close-up on expressive dramatic stage gesture, silk costume accents, glowing incandescent chandeliers.` },
      ];

      const chosen = variations[Math.floor(Math.random() * variations.length)];
      db.prepare('UPDATE scenes SET narration=?, visualPrompt=? WHERE id=?').run(chosen.narration, chosen.prompt, scene.id);

      const updated = db.prepare('SELECT * FROM scenes WHERE id=?').get(scene.id);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Scene regeneration failed' });
    }
  });

  // Get Platform Adaptations
  router.get('/content/:id/adaptations', (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);

      const item = db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(id, userId) as any;
      if (!item) return res.status(404).json({ error: 'Content item not found' });

      const brand = getBrandContext(item.brandId, userId);
      const script = db.prepare('SELECT * FROM scripts WHERE contentItemId=?').get(id) as any;
      if (!script) return res.status(400).json({ error: 'Script missing' });

      const scenes = db.prepare('SELECT sceneOrder, narration FROM scenes WHERE scriptId=? ORDER BY sceneOrder ASC').all(script.id) as any[];

      const adapted = PlatformAdaptationEngine.adapt(brand, script, scenes);
      res.json(adapted);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Adaptation failed' });
    }
  });

  // Schedule to Publishing Calendar
  router.post('/content/:id/schedule', (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const userId = uid(req);

      const schema = z.object({
        platform: z.enum(['YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'ALL']),
        scheduledAt: z.string(), // ISO String or YYYY-MM-DD HH:mm
        customTitle: z.string().optional(),
        customCaption: z.string().optional(),
        customHashtags: z.array(z.string()).optional(),
      });

      const p = schema.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.errors[0].message });

      const item = db.prepare('SELECT * FROM content_items WHERE id=? AND ownerId=?').get(id, userId) as any;
      if (!item) return res.status(404).json({ error: 'Content item not found' });

      const brand = getBrandContext(item.brandId, userId);
      const script = db.prepare('SELECT * FROM scripts WHERE contentItemId=?').get(id) as any;
      const scenes = script ? db.prepare('SELECT sceneOrder, narration FROM scenes WHERE scriptId=? ORDER BY sceneOrder ASC').all(script.id) as any[] : [];

      const adapted = script ? PlatformAdaptationEngine.adapt(brand, script, scenes) : null;
      const platformsToSchedule = p.data.platform === 'ALL' ? ['YOUTUBE', 'INSTAGRAM', 'TIKTOK'] : [p.data.platform];
      const createdSchedules: any[] = [];

      for (const plt of platformsToSchedule) {
        const pltKey = plt.toLowerCase() as 'youtube' | 'instagram' | 'tiktok';
        const meta = adapted ? (adapted as any)[pltKey] : null;

        const title = p.data.customTitle || meta?.title || item.title;
        const caption = p.data.customCaption || meta?.caption || item.title;
        const hashtags = p.data.customHashtags || meta?.hashtags || [];

        const row = db.prepare(`
          INSERT INTO publishing_schedules(ownerId, brandId, contentItemId, platform, scheduledAt, status, customTitle, customCaption, customHashtags)
          VALUES (?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?)
        `).run(
          userId,
          brand.id,
          id,
          plt,
          p.data.scheduledAt,
          title,
          caption,
          JSON.stringify(hashtags)
        );

        createdSchedules.push({
          id: row.lastInsertRowid,
          platform: plt,
          scheduledAt: p.data.scheduledAt,
          title,
          caption,
          hashtags,
        });
      }

      db.prepare("UPDATE content_items SET status='SCHEDULED' WHERE id=?").run(id);

      res.status(201).json({
        ok: true,
        status: 'SCHEDULED',
        schedules: createdSchedules,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Scheduling failed' });
    }
  });

  // Get Calendar Schedules
  router.get('/schedules', (req: Request, res: Response) => {
    const userId = uid(req);
    const brandId = req.query.brandId ? Number(req.query.brandId) : null;

    let query = `
      SELECT s.*, b.name as brandName, b.handle as brandHandle, c.title as contentTitle
      FROM publishing_schedules s
      JOIN brands b ON s.brandId = b.id
      JOIN content_items c ON s.contentItemId = c.id
      WHERE s.ownerId = ?
    `;
    const params: any[] = [userId];

    if (brandId) {
      query += ' AND s.brandId = ?';
      params.push(brandId);
    }
    query += ' ORDER BY s.scheduledAt ASC';

    const rows = db.prepare(query).all(...params) as any[];
    const parsed = rows.map((r) => ({
      ...r,
      customHashtags: typeof r.customHashtags === 'string' ? JSON.parse(r.customHashtags) : [],
    }));
    res.json(parsed);
  });

  // Cancel Schedule
  router.delete('/schedules/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const userId = uid(req);
    const schedule = db.prepare('SELECT * FROM publishing_schedules WHERE id=? AND ownerId=?').get(id, userId);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

    db.prepare("UPDATE publishing_schedules SET status='CANCELLED' WHERE id=?").run(id);
    res.json({ ok: true });
  });

  return router;
}
