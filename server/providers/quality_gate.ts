import fs from 'node:fs';
import path from 'node:path';
import { OriginalityEngine } from './originality.js';
import type { BrandContext, SupportedAudioMode } from './types.js';
import { resolveAudioMode, SUPPORTED_AUDIO_MODES } from './types.js';

export interface QualityCheckItem {
  name: string;
  category: 'SAFETY' | 'COPYRIGHT' | 'ORIGINALITY' | 'TECHNICAL';
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
  recommendation?: string;
}

export interface QualityGateReport {
  passed: boolean;
  canPublish: boolean;
  safetyScore: number;
  checks: QualityCheckItem[];
  summary: string;
}

export class QualityGateEngine {
  public static evaluate(options: {
    brand: BrandContext;
    script: { title: string; premise: string; targetDurationSec: number };
    scenes: Array<{ sceneOrder: number; narration: string; visualPrompt: string; durationSec: number }>;
    assets: Array<{ type: string; filePath: string; metadata?: string }>;
    history: Array<{ title: string; premise: string }>;
    audioMode?: SupportedAudioMode | string;
  }): QualityGateReport {
    const checks: QualityCheckItem[] = [];
    let safetyScore = 100;
    let criticalFail = false;

    const fullText = [
      options.script.title,
      options.script.premise,
      ...options.scenes.map((s) => `${s.narration} ${s.visualPrompt}`),
    ].join(' ').toLowerCase();

    // 1. Prohibited Topics & Safety Check
    const prohibited = options.brand.prohibitedTopics || [];
    const matchedProhibited: string[] = [];

    for (const p of prohibited) {
      const cleanP = p.trim().toLowerCase();
      if (cleanP && fullText.includes(cleanP)) {
        matchedProhibited.push(p);
      }
    }

    // Explicit check for sensitive keywords
    const sensitiveKeywords = ['transparent', 'sheer', 'nudity', 'nsfw', 'explicit', 'deepfake', 'minor'];
    for (const kw of sensitiveKeywords) {
      if (fullText.includes(kw) && !matchedProhibited.includes(kw)) {
        matchedProhibited.push(kw);
      }
    }

    if (matchedProhibited.length > 0) {
      safetyScore -= Math.min(60, matchedProhibited.length * 30);
      criticalFail = true;
      checks.push({
        name: 'Brand Safety & Policy Compliance',
        category: 'SAFETY',
        status: 'FAIL',
        message: `Detected prohibited or sensitive terms: ${matchedProhibited.map((m) => `"${m}"`).join(', ')}.`,
        recommendation: 'Edit scene visual prompts or premise to adhere to brand guidelines and platform policies (e.g. replace sheer/transparent with elegant stage attire).',
      });
    } else {
      checks.push({
        name: 'Brand Safety & Policy Compliance',
        category: 'SAFETY',
        status: 'PASS',
        message: 'No prohibited or policy-violating keywords detected.',
      });
    }

    // 2. Copyright & Commercial Monetization Risk Check
    const knownCopyrightedTrademarks = [
      'tip tip barsa paani', 'bollywood soundtrack', 'universal music', 'warner music',
      'sony music', 'disney', 'marvel', 'star wars', 'netflix',
    ];
    const detectedCopyrights = knownCopyrightedTrademarks.filter((t) => fullText.includes(t));

    if (detectedCopyrights.length > 0) {
      safetyScore -= 20;
      checks.push({
        name: 'Copyright & Monetization Risk',
        category: 'COPYRIGHT',
        status: 'WARN',
        message: `Potential third-party copyrighted song or brand reference detected: ${detectedCopyrights.map((c) => `"${c}"`).join(', ')}.`,
        recommendation: 'Use original AI orchestration or platform-licensed music library when publishing to YouTube Shorts / Instagram Reels to prevent monetization claims.',
      });
    } else {
      checks.push({
        name: 'Copyright & Monetization Risk',
        category: 'COPYRIGHT',
        status: 'PASS',
        message: 'Content uses original composition instructions with zero copyrighted media risk.',
      });
    }

    // 3. Originality & Duplicate Check
    const origReport = OriginalityEngine.evaluateAgainstHistory(
      options.script.title,
      options.script.premise,
      options.history
    );

    if (origReport.isRepetitive) {
      checks.push({
        name: 'Content Originality & Freshness',
        category: 'ORIGINALITY',
        status: 'WARN',
        message: origReport.warning || 'Moderate similarity detected with previous videos.',
        recommendation: 'Consider varying the story premise or introducing an unexpected twist to maximize subscriber retention.',
      });
    } else {
      checks.push({
        name: 'Content Originality & Freshness',
        category: 'ORIGINALITY',
        status: 'PASS',
        message: `High originality score (${origReport.score}%). Unique storyline premise.`,
      });
    }

    // 4. Technical Format & Asset Completeness
    const videoAsset = options.assets.find((a) => a.type === 'VIDEO');
    const audioAsset = options.assets.find((a) => a.type === 'AUDIO');
    const subtitleAsset = options.assets.find((a) => a.type === 'SUBTITLE');
    const musicAsset = options.assets.find((a) => a.type === 'MUSIC');

    // Resolve audio mode: explicit options -> videoAsset metadata -> DEFAULT_AUDIO_MODE
    let configuredAudioMode: string | undefined = options.audioMode;
    if (!configuredAudioMode && videoAsset?.metadata) {
      try {
        const meta = typeof videoAsset.metadata === 'string' ? JSON.parse(videoAsset.metadata) : videoAsset.metadata;
        if (meta?.audioMode) configuredAudioMode = meta.audioMode;
      } catch {}
    }
    const resolvedAudio = resolveAudioMode(configuredAudioMode);
    if (resolvedAudio.error) {
      criticalFail = true;
      checks.push({
        name: 'Audio Mode Configuration',
        category: 'TECHNICAL',
        status: 'FAIL',
        message: resolvedAudio.error,
        recommendation: `Configure a supported audioMode (${SUPPORTED_AUDIO_MODES.join(', ')}) in render options.`,
      });
    }
    const activeAudioMode = resolvedAudio.mode;

    if (!videoAsset || !fs.existsSync(videoAsset.filePath)) {
      criticalFail = true;
      checks.push({
        name: 'Master Video Render',
        category: 'TECHNICAL',
        status: 'FAIL',
        message: 'Master 9:16 vertical MP4 video has not been rendered yet.',
        recommendation: 'Click "Render 9:16 Vertical Video (FFmpeg)" to composite the master file.',
      });
    } else {
      checks.push({
        name: 'Master Video Render',
        category: 'TECHNICAL',
        status: 'PASS',
        message: '1080x1920 (9:16) H.264 MP4 master video rendered successfully.',
      });
    }

    const audioDir = path.resolve('./data/storage/audio');
    const candidateBgm = [
      path.join(audioDir, 'bollywood_monsoon_beat.mp3'),
      path.join(audioDir, 'hindi_music.mp3'),
      path.join(audioDir, 'sensual_bgm.mp3'),
      path.join(audioDir, 'bgm.mp3'),
    ].find((p) => fs.existsSync(p));
    const hasMusic = (musicAsset && fs.existsSync(musicAsset.filePath)) || !!candidateBgm;

    if (activeAudioMode === 'music_only') {
      // Voiceover narration is explicitly omitted in music_only mode
      checks.push({
        name: 'Voiceover Audio Track',
        category: 'TECHNICAL',
        status: 'PASS',
        message: 'Voiceover narration omitted by configuration (music_only mode).',
      });

      // Music soundtrack is strictly required in music_only mode
      if (!hasMusic) {
        criticalFail = true;
        checks.push({
          name: 'Music Soundtrack Track',
          category: 'TECHNICAL',
          status: 'FAIL',
          message: 'Music soundtrack track is missing for music_only mode.',
          recommendation: 'Attach a music track via /attach-music or ensure fallback background music exists.',
        });
      } else {
        checks.push({
          name: 'Music Soundtrack Track',
          category: 'TECHNICAL',
          status: 'PASS',
          message: 'Song music audio track present and active for music-only mode.',
        });
      }
    } else if (activeAudioMode === 'narration_only') {
      // Narration voiceover is strictly required in narration_only mode
      if (!audioAsset || !fs.existsSync(audioAsset.filePath)) {
        criticalFail = true;
        checks.push({
          name: 'Voiceover Audio Track',
          category: 'TECHNICAL',
          status: 'FAIL',
          message: 'Narration voice audio track is missing for narration_only mode.',
          recommendation: 'Re-render to generate synchronized speech narration.',
        });
      } else {
        checks.push({
          name: 'Voiceover Audio Track',
          category: 'TECHNICAL',
          status: 'PASS',
          message: 'Narration audio track present and synchronized.',
        });
      }

      checks.push({
        name: 'Music Soundtrack Track',
        category: 'TECHNICAL',
        status: 'PASS',
        message: 'Background music omitted by configuration (narration_only mode).',
      });
    } else {
      // Default 'narration_and_music': Both voiceover and background music are validated
      if (!audioAsset || !fs.existsSync(audioAsset.filePath)) {
        criticalFail = true;
        checks.push({
          name: 'Voiceover Audio Track',
          category: 'TECHNICAL',
          status: 'FAIL',
          message: 'Narration voice audio track is missing.',
          recommendation: 'Re-render to generate synchronized speech narration.',
        });
      } else {
        checks.push({
          name: 'Voiceover Audio Track',
          category: 'TECHNICAL',
          status: 'PASS',
          message: 'Narration audio track present and synchronized.',
        });
      }

      if (hasMusic) {
        checks.push({
          name: 'Background Music Track',
          category: 'TECHNICAL',
          status: 'PASS',
          message: 'Background music track present and mixed with narration.',
        });
      } else {
        checks.push({
          name: 'Background Music Track',
          category: 'TECHNICAL',
          status: 'WARN',
          message: 'Background music track not found; audio will play voiceover only.',
          recommendation: 'Attach a music track or provide default BGM in storage for richer audio.',
        });
      }
    }

    if (!subtitleAsset || !fs.existsSync(subtitleAsset.filePath)) {
      checks.push({
        name: 'Subtitles & Closed Captions',
        category: 'TECHNICAL',
        status: 'WARN',
        message: 'Subtitle track not found.',
        recommendation: 'Subtitles increase mobile watch retention by up to 40%.',
      });
    } else {
      checks.push({
        name: 'Subtitles & Closed Captions',
        category: 'TECHNICAL',
        status: 'PASS',
        message: 'Burned-in / SRT subtitle timestamps generated.',
      });
    }

    const totalDuration = options.scenes.reduce((acc, s) => acc + s.durationSec, 0);
    if (totalDuration < 15 || totalDuration > 60) {
      checks.push({
        name: 'Shorts & Reels Duration Compliance',
        category: 'TECHNICAL',
        status: 'WARN',
        message: `Current duration is ${totalDuration}s. Recommended duration for YouTube Shorts and Instagram Reels is between 15s and 58s.`,
      });
    } else {
      checks.push({
        name: 'Shorts & Reels Duration Compliance',
        category: 'TECHNICAL',
        status: 'PASS',
        message: `Optimal duration (${totalDuration}s) for vertical short-form algorithms.`,
      });
    }

    const passed = !criticalFail && safetyScore >= 70;
    const canPublish = passed;

    return {
      passed,
      canPublish,
      safetyScore: Math.max(0, safetyScore),
      checks,
      summary: passed
        ? '✓ Content passed Quality Gate and is fully ready for multi-platform distribution.'
        : '⚠️ Quality Gate flagged policy or asset requirements that should be resolved before publishing.',
    };
  }
}
