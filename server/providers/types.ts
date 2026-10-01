export interface BrandContext {
  id: number;
  name: string;
  handle?: string;
  niche?: string;
  tone?: string;
  language?: string;
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

export interface IdeaItem {
  title: string;
  premise: string;
  category: string;
  potentialScore: number;
  originalityScore: number;
  visualPotentialScore: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  audienceFit: string;
  tags: string[];
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
  generateStory(brand: BrandContext, topic: string, customPremise?: string, character?: CharacterContext): Promise<GeneratedStory>;
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
  }): Promise<{ filePath: string; durationSec: number }>;
}
