export interface BrandContext {
  id: number;
  name: string;
  handle?: string;
  niche?: string;
  tone?: string;
  language?: string;
  country?: string;
  targetAgeMin?: number;
  targetAgeMax?: number;
  targetGender?: string;
  preferredTopics: string[];
  prohibitedTopics: string[];
  visualStyle?: string;
  contentRules?: string;
  audienceProfile?: {
    name: string;
    interests: string[];
    avoid: string[];
    tone?: string;
    preferredDurationSec?: string;
  };
}

export interface LLMExecutionMetadata {
  readonly provider: 'ollama' | 'deterministic' | string;
  readonly fallbackOccurred: boolean;
  readonly model?: string;
  readonly fallbackReason?: string;
  readonly latencyMs?: number;
}

export interface IdeaItem {
  title: string;
  premise: string;
  category: string;
  potentialScore: number | null;
  originalityScore: number;
  visualPotentialScore: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  audienceFit: string;
  tags: string[];
  scoreSource?: 'model' | 'deterministic' | 'unavailable';
  metadata?: LLMExecutionMetadata;
}

export interface GeneratedStoryScene {
  sceneOrder: number;
  durationSec: number;
  narration: string;
  dialogue?: string;
  visualPrompt: string;
  voiceDirection: string;
  soundEffects?: string;
  musicDirection?: string;
  endingType?: string;
}

export interface GeneratedStory {
  title: string;
  hook: string;
  premise: string;
  targetDurationSec: number;
  language: string;
  tone: string;
  endingType: string;
  scenes: GeneratedStoryScene[];
  metadata?: LLMExecutionMetadata;
}

export interface CharacterContext {
  id?: number;
  name: string;
  age?: number;
  personality?: string;
  appearance?: string;
  clothingStyle?: string;
  visualPrompt?: string;
  voiceStyle?: string;
}

export interface LLMProvider {
  generateIdeas(brand: BrandContext, count?: number): Promise<IdeaItem[]>;
  generateStory(brand: BrandContext, topic: string, customPremise?: string, character?: CharacterContext, userId?: number): Promise<GeneratedStory>;
}

export interface TTSProvider {
  synthesize(text: string, voiceStyle?: string, outputFile?: string): Promise<{ filePath: string; durationSec: number }>;
}

export interface ImageProvider {
  generateSceneImage(
    prompt: string,
    style: string,
    outputFile?: string,
    overlayText?: string,
    narration?: string,
    characterPortraitPath?: string
  ): Promise<{ filePath: string }>;
}

export const SUPPORTED_AUDIO_MODES = ['narration_and_music', 'music_only', 'narration_only'] as const;
export type SupportedAudioMode = typeof SUPPORTED_AUDIO_MODES[number];
export const DEFAULT_AUDIO_MODE: SupportedAudioMode = 'narration_and_music';

/**
 * Resolves the authoritative audio mode according to strict precedence:
 * 1. Explicit audio mode supplied in the request.
 * 2. Persisted project or render configuration.
 * 3. Documented application default ('narration_and_music').
 */
export function resolveAudioMode(
  explicitMode?: unknown,
  persistedMode?: unknown
): { mode: SupportedAudioMode; error?: string } {
  // 1. Explicit request configuration takes precedence
  if (explicitMode !== undefined && explicitMode !== null && explicitMode !== '') {
    if (typeof explicitMode === 'string' && (SUPPORTED_AUDIO_MODES as readonly string[]).includes(explicitMode)) {
      return { mode: explicitMode as SupportedAudioMode };
    }
    return {
      mode: DEFAULT_AUDIO_MODE,
      error: `Invalid audioMode '${String(explicitMode)}'. Supported modes are: ${SUPPORTED_AUDIO_MODES.join(', ')}`,
    };
  }

  // 2. Persisted project or render configuration when request configuration is absent
  if (persistedMode !== undefined && persistedMode !== null && persistedMode !== '') {
    if (typeof persistedMode === 'string' && (SUPPORTED_AUDIO_MODES as readonly string[]).includes(persistedMode)) {
      return { mode: persistedMode as SupportedAudioMode };
    }
  }

  // 3. Documented application default when neither is available
  return { mode: DEFAULT_AUDIO_MODE };
}

export interface VideoProvider {
  renderShort(options: {
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
    audioMode?: SupportedAudioMode;
  }): Promise<{ filePath: string; durationSec: number }>;
}
