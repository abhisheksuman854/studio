import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DB } from '../db.js';
import { Resvg } from '@resvg/resvg-js';

const execFileAsync = promisify(execFile);

export interface CharacterEntity {
  id: number;
  ownerId: number;
  brandId: number;
  name: string;
  description: string;
  age: number;
  personality: string;
  appearance: string;
  clothingStyle: string;
  visualPrompt: string;
  negativePrompt: string;
  voiceStyle: string;
  referenceImage: string;
  generationModel: string;
  generationParameters: Record<string, any>;
  identityTokens: string[];
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

export interface CharacterGenerateOptions {
  ownerId: number;
  brandId: number;
  name: string;
  role?: string;
  region?: string;
  age?: number;
  appearance: string;
  clothingStyle: string;
  personality?: string;
  voiceStyle?: string;
  customPrompt?: string;
  negativePrompt?: string;
  seed?: number;
  referenceImage?: string;
  aiWorkerUrl?: string;
  apiKey?: string;
  testMock?: boolean;
}

export interface PortraitPreviewOptions {
  name: string;
  role?: string;
  region?: string;
  appearance: string;
  clothingStyle: string;
  visualPrompt?: string;
  negativePrompt?: string;
  seed?: number;
  testMock?: boolean;
}

export interface PortraitPreviewResult {
  previewImageUrl: string;
  filePath: string;
  prompt: string;
  negativePrompt: string;
  seed: number;
  identityTokens: string[];
  model: string;
  fileSize: number;
  dimensions: [number, number];
  timings?: Record<string, number>;
  pixelStats?: Record<string, any>;
}

export function extractIdentityTokens(appearance: string, costume: string): string[] {
  const tokens: string[] = [];
  const rawClauses = `${appearance}, ${costume}`
    .split(/[,;•\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 3 && !['wearing', 'with', 'and', 'looks', 'style'].includes(s));

  for (const clause of rawClauses) {
    if (!tokens.includes(clause)) {
      tokens.push(clause);
    }
  }
  return tokens.slice(0, 8);
}

export function injectSceneIdentity(
  sceneVisualPrompt: string,
  characterOrTokens: CharacterEntity | string[],
  name?: string
): string {
  const tokens: string[] = Array.isArray(characterOrTokens)
    ? characterOrTokens
    : characterOrTokens.identityTokens || [];
  const charName = name || (Array.isArray(characterOrTokens) ? '' : characterOrTokens.name);
  const tokenString = tokens.length > 0 ? tokens.join(', ') : '';

  let enrichedPrompt = sceneVisualPrompt;
  if (charName && !enrichedPrompt.toLowerCase().includes(charName.toLowerCase())) {
    enrichedPrompt = `ultra-detailed portrait featuring ${charName} (${tokenString}), ${enrichedPrompt}`;
  } else {
    enrichedPrompt = `ultra-detailed portrait, consistent face of ${charName || 'dancer'}, ${tokenString}, ${enrichedPrompt}`;
  }

  return enrichedPrompt;
}

/**
 * Execute local SDXL generation via Python script using Apple MPS denoising and CPU FP32 VAE decoding.
 */
async function executeLocalSDXL(params: {
  prompt: string;
  negativePrompt: string;
  outputPath: string;
  seed: number;
  width?: number;
  height?: number;
  steps?: number;
}): Promise<{ ok: boolean; metadata?: any; error?: string }> {
  const pythonBin = process.env.AURAVO_PYTHON_BIN || '/Users/abhisheksuman/.local/share/auravo/venvs/phase2a/bin/python';
  const scriptPath = path.resolve('./server/scripts/generate_sdxl_character.py');
  const cacheDir = process.env.AURAVO_MODEL_CACHE || '/Users/abhisheksuman/.local/share/auravo/models/phase2b/cache';

  if (!fs.existsSync(pythonBin) || !fs.existsSync(scriptPath)) {
    return { ok: false, error: 'Local Python SDXL virtualenv or generator script not found on disk.' };
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonBin,
      [
        scriptPath,
        '--prompt', params.prompt,
        '--negative-prompt', params.negativePrompt,
        '--output-path', params.outputPath,
        '--seed', String(params.seed),
        '--width', String(params.width || 1024),
        '--height', String(params.height || 1024),
        '--steps', String(params.steps || 4),
        '--cache-dir', cacheDir,
      ],
      {
        env: {
          ...process.env,
          DYLD_LIBRARY_PATH: '/opt/homebrew/opt/expat/lib',
          HF_HUB_DISABLE_XET: '1',
          HF_HUB_OFFLINE: '1',
        },
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    const lines = stdout.trim().split('\n');
    let parsed: any = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        parsed = JSON.parse(lines[i]);
        if (parsed && parsed.ok) break;
      } catch (_) {}
    }

    if (!parsed || !parsed.ok) {
      return { ok: false, error: `Invalid generator output: ${stdout.slice(-500)} (stderr: ${stderr.slice(-300)})` };
    }

    if (!fs.existsSync(params.outputPath) || fs.statSync(params.outputPath).size < 10000) {
      return { ok: false, error: 'Generated image file is missing or invalid (<10KB).' };
    }

    return { ok: true, metadata: parsed };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Execution error during local SDXL synthesis' };
  }
}

/**
 * Generate a deterministic synthetic test PNG for unit testing in CI / test environments
 * when GPU execution is disabled or running fast automated unit test suites.
 */
function generateTestMockImage(targetFilePath: string, name: string): void {
  const svg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <rect width="1024" height="1024" fill="#0f172a" />
    <circle cx="512" cy="512" r="300" fill="#1e293b" stroke="#38bdf8" stroke-width="8" />
    <text x="512" y="520" font-family="sans-serif" font-size="42" font-weight="bold" fill="#f8fafc" text-anchor="middle">
      TEST MOCK: ${name.replace(/[^a-zA-Z0-9 ]/g, '')}
    </text>
  </svg>`;
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } });
  fs.writeFileSync(targetFilePath, resvg.render().asPng());
}

export class CharacterGeneratorProvider {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  public extractIdentityTokens(appearance: string, costume: string): string[] {
    return extractIdentityTokens(appearance, costume);
  }

  /**
   * Generates a live portrait preview without saving to the database.
   * Allows full inspection of generated image, seed, prompt, and numerical metrics.
   */
  async generatePortraitPreview(options: PortraitPreviewOptions): Promise<PortraitPreviewResult> {
    const storageDir = path.resolve('./data/storage/images');
    fs.mkdirSync(storageDir, { recursive: true });

    const previewTimestamp = Date.now();
    const filename = `preview_${options.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${previewTimestamp}.png`;
    const targetFilePath = path.join(storageDir, filename);
    const publicUrl = `/api/media/images/${filename}`;

    const identityTokens = this.extractIdentityTokens(options.appearance, options.clothingStyle);
    const tokenString = identityTokens.join(', ');

    const visualPrompt = options.visualPrompt ||
      `Photorealistic portrait of ${options.name}, ${options.appearance}, wearing ${options.clothingStyle}. ${options.role ? `Role: ${options.role}.` : ''} High contrast studio rim lighting, cinematic 8k resolution.`;

    const negativePrompt = options.negativePrompt ||
      'blurry, distorted, bad anatomy, deformed eyes, extra limbs, low resolution, cartoonish, 3d render, plastic skin, oversaturated';

    const seed = options.seed !== undefined ? options.seed : Math.floor(Math.random() * 1000000);

    const isTestMode = options.testMock || process.env.NODE_ENV === 'test' || process.env.AURAVO_TEST_MOCK_GEN === '1';

    let modelUsed = 'SDXL_LIGHTNING_LOCAL_MPS_CPU_VAE';
    let timings: Record<string, number> = {};
    let pixelStats: Record<string, any> = {};

    if (!isTestMode) {
      const result = await executeLocalSDXL({
        prompt: visualPrompt,
        negativePrompt,
        outputPath: targetFilePath,
        seed,
        width: 1024,
        height: 1024,
        steps: 4,
      });

      if (!result.ok) {
        throw new Error(`Local SDXL image generation failed: ${result.error}`);
      }

      timings = result.metadata?.timings || {};
      pixelStats = result.metadata?.pixel_stats || {};
    } else {
      modelUsed = 'SDXL_LIGHTNING_TEST_MOCK';
      generateTestMockImage(targetFilePath, options.name);
      pixelStats = { min: 15, max: 248, mean: 120.5, std: 45.2, unique_colors: 15000, valid_render: true };
      timings = { denoise_seconds: 0.1, vae_seconds: 0.1, total_seconds: 0.2 };
    }

    const fileSize = fs.statSync(targetFilePath).size;

    return {
      previewImageUrl: publicUrl,
      filePath: targetFilePath,
      prompt: visualPrompt,
      negativePrompt,
      seed,
      identityTokens,
      model: modelUsed,
      fileSize,
      dimensions: [1024, 1024],
      timings,
      pixelStats,
    };
  }

  /**
   * Generates a persistent AI character portrait, locks identity tokens,
   * and saves the Character record with generation metadata into SQLite.
   */
  async generateAndPersistCharacter(options: CharacterGenerateOptions): Promise<CharacterEntity> {
    const storageDir = path.resolve('./data/storage/images');
    fs.mkdirSync(storageDir, { recursive: true });

    const charTimestamp = Date.now();
    const filename = `char_${options.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${charTimestamp}.png`;
    const targetFilePath = path.join(storageDir, filename);
    const publicUrl = `/storage/images/${filename}`;

    const identityTokens = this.extractIdentityTokens(options.appearance, options.clothingStyle);
    const seed = options.seed !== undefined ? options.seed : Math.floor(Math.random() * 1000000);

    const visualPrompt = options.customPrompt ||
      `Photorealistic vertical portrait of ${options.name}, ${options.appearance}, wearing ${options.clothingStyle}. High contrast stage lighting, cinematic 8k resolution.`;

    const negativePrompt = options.negativePrompt ||
      'blurry, distorted, bad anatomy, deformed eyes, extra limbs, low resolution, cartoonish, 3d render, plastic skin';

    let generationModel = 'SDXL_LIGHTNING_LOCAL_MPS_CPU_VAE';
    const generationParams: Record<string, any> = {
      model: 'ByteDance/SDXL-Lightning (4-step MPS + CPU VAE)',
      aspectRatio: '1:1',
      resolution: '1024x1024',
      seed,
      steps: 4,
      guidanceScale: 0,
      tokens: identityTokens,
    };

    let generatedSuccessfully = false;

    // If an existing valid reference image was passed from a preview, reuse it
    if (options.referenceImage) {
      let refPath = '';
      if (options.referenceImage.startsWith('/api/media/images/')) {
        refPath = path.join(storageDir, options.referenceImage.replace('/api/media/images/', ''));
      } else if (options.referenceImage.startsWith('/storage/images/')) {
        refPath = path.join(storageDir, options.referenceImage.replace('/storage/images/', ''));
      } else if (fs.existsSync(options.referenceImage)) {
        refPath = options.referenceImage;
      }

      if (refPath && fs.existsSync(refPath)) {
        fs.copyFileSync(refPath, targetFilePath);
        generatedSuccessfully = true;
      }
    }

    const isTestMode = options.testMock || process.env.NODE_ENV === 'test' || process.env.AURAVO_TEST_MOCK_GEN === '1';

    if (!generatedSuccessfully) {
      if (!isTestMode) {
        // Attempt local SDXL generation
        const result = await executeLocalSDXL({
          prompt: visualPrompt,
          negativePrompt,
          outputPath: targetFilePath,
          seed,
          width: 1024,
          height: 1024,
          steps: 4,
        });

        if (result.ok) {
          generatedSuccessfully = true;
          generationParams.timings = result.metadata?.timings;
          generationParams.pixelStats = result.metadata?.pixel_stats;
          generationParams.sha256 = result.metadata?.sha256;
        } else {
          // If remote Colab worker is specified, try fallback
          const workerUrl = options.aiWorkerUrl || process.env.NEURAL_DANCE_GPU_URL;
          if (workerUrl) {
            try {
              const cleanUrl = workerUrl.replace(/\/+$/, '');
              const headers: Record<string, string> = { 'Content-Type': 'application/json' };
              if (options.apiKey || process.env.AI_WORKER_SECRET) {
                headers['Authorization'] = `Bearer ${options.apiKey || process.env.AI_WORKER_SECRET}`;
              }
              const resp = await fetch(`${cleanUrl}/api/generate-character`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ prompt: visualPrompt, negativePrompt, seed, aspectRatio: '1:1' }),
              });
              if (resp.ok) {
                const arrayBuf = await resp.arrayBuffer();
                if (arrayBuf.byteLength > 1000) {
                  fs.writeFileSync(targetFilePath, Buffer.from(arrayBuf));
                  generatedSuccessfully = true;
                  generationModel = 'SDXL_LIGHTNING_T4_GPU';
                }
              }
            } catch (err: any) {
              console.warn('[CharacterGenerator] GPU worker failed:', err.message);
            }
          }

          if (!generatedSuccessfully) {
            throw new Error(`AI Character Generation failed: ${result.error}. Placeholder mockups are prohibited.`);
          }
        }
      } else {
        // Fast test mock execution
        generationModel = 'SDXL_LIGHTNING_TEST_MOCK';
        generateTestMockImage(targetFilePath, options.name);
        generatedSuccessfully = true;
      }
    }

    // Persist Character Entity into SQLite
    const row = this.db.prepare(`
      INSERT INTO characters (
        ownerId, brandId, name, description, age, personality, appearance,
        clothingStyle, visualPrompt, negativePrompt, voiceStyle,
        referenceImage, generationModel, generationParameters, identityTokens, metadata, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      options.ownerId,
      options.brandId,
      options.name,
      `${options.role || 'Soloist'} — ${options.personality || 'Captivating presence'}`,
      options.age || 24,
      options.personality || 'Fierce, elegant, captivating presence',
      options.appearance,
      options.clothingStyle,
      visualPrompt,
      negativePrompt,
      options.voiceStyle || 'Samantha',
      publicUrl,
      generationModel,
      JSON.stringify(generationParams),
      JSON.stringify(identityTokens),
      JSON.stringify({ region: options.region, modelType: generationModel })
    );

    return this.getCharacterById(Number(row.lastInsertRowid), options.ownerId)!;
  }

  getCharacterById(id: number, ownerId: number): CharacterEntity | undefined {
    const raw = this.db.prepare('SELECT * FROM characters WHERE id=? AND ownerId=?').get(id, ownerId) as any;
    if (!raw) return undefined;

    return {
      ...raw,
      generationParameters: typeof raw.generationParameters === 'string' ? JSON.parse(raw.generationParameters || '{}') : raw.generationParameters,
      identityTokens: typeof raw.identityTokens === 'string' ? JSON.parse(raw.identityTokens || '[]') : raw.identityTokens,
      metadata: typeof raw.metadata === 'string' ? JSON.parse(raw.metadata || '{}') : raw.metadata,
    };
  }

  listCharacters(brandId: number, ownerId: number): CharacterEntity[] {
    const rows = this.db.prepare('SELECT * FROM characters WHERE brandId=? AND ownerId=? ORDER BY id DESC').all(brandId, ownerId) as any[];
    return rows.map((raw) => ({
      ...raw,
      generationParameters: typeof raw.generationParameters === 'string' ? JSON.parse(raw.generationParameters || '{}') : raw.generationParameters,
      identityTokens: typeof raw.identityTokens === 'string' ? JSON.parse(raw.identityTokens || '[]') : raw.identityTokens,
      metadata: typeof raw.metadata === 'string' ? JSON.parse(raw.metadata || '{}') : raw.metadata,
    }));
  }

  public injectSceneIdentity(sceneVisualPrompt: string, character: CharacterEntity): { visualPrompt: string; negativePrompt: string } {
    const tokens = character.identityTokens || [];
    const tokenString = tokens.length > 0 ? tokens.join(', ') : character.appearance;

    let enrichedPrompt = sceneVisualPrompt;
    if (!enrichedPrompt.toLowerCase().includes(character.name.toLowerCase())) {
      enrichedPrompt = `Featuring ${character.name} (${tokenString}). ${enrichedPrompt}`;
    } else {
      enrichedPrompt = `${enrichedPrompt}, highly consistent face of ${character.name}, ${tokenString}`;
    }

    if (character.clothingStyle && !enrichedPrompt.toLowerCase().includes(character.clothingStyle.toLowerCase())) {
      enrichedPrompt = `${enrichedPrompt}, dressed in ${character.clothingStyle}`;
    }

    return {
      visualPrompt: enrichedPrompt,
      negativePrompt: character.negativePrompt || 'blurry, cartoon, 3d, deformed eyes, face distortion',
    };
  }
}
