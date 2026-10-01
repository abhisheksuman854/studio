import type { BrandContext } from './types.js';

export interface PlatformMetadata {
  title?: string;
  caption: string;
  hashtags: string[];
  recommendedTime: string;
  tags?: string[];
  cta: string;
  aiDisclosure: boolean;
}

export interface AdaptedPlatforms {
  youtube: PlatformMetadata;
  instagram: PlatformMetadata;
  tiktok: PlatformMetadata;
}

export class PlatformAdaptationEngine {
  public static adapt(
    brand: BrandContext,
    script: { title: string; hook: string; premise: string; targetDurationSec: number },
    scenes: Array<{ sceneOrder: number; narration: string }>
  ): AdaptedPlatforms {
    const brandName = brand.name || 'Studio';
    const handle = brand.handle || `@${brandName.toLowerCase().replace(/\s+/g, '')}`;

    // Clean tags
    const cleanTag = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '');
    const nicheTags = (brand.preferredTopics || [])
      .map(cleanTag)
      .filter(Boolean)
      .slice(0, 4);

    // YouTube Shorts Adaptation
    const youtubeTitle = `${script.title} — ${script.hook.slice(0, 45)}... #Shorts`;
    const youtubeDescription = `
${script.hook}

${script.premise}

🎭 Brand: ${brandName} (${handle})
🎬 Episode Duration: ${script.targetDurationSec}s
🎵 Original Audio & Narration

🔔 Subscribe to ${brandName} for daily dramatic stories & cinematic choreography.

#Shorts #${cleanTag(brandName)} ${nicheTags.map((t) => `#${t}`).join(' ')}
    `.trim();

    const youtube: PlatformMetadata = {
      title: youtubeTitle.slice(0, 100),
      caption: youtubeDescription,
      hashtags: ['Shorts', cleanTag(brandName), ...nicheTags],
      tags: [brandName, 'Shorts', 'Choreography', 'Story', ...nicheTags],
      recommendedTime: '18:00 (6:00 PM)',
      cta: `Subscribe to ${handle} for the next chapter.`,
      aiDisclosure: true,
    };

    // Instagram Reels Adaptation
    const instagramCaption = `
${script.hook} ✨

${script.premise}

Did you notice the sequence in the final scene? 👇

Follow ${handle} for daily aesthetic choreography & stage stories.
Save this Reel for later 🔖

.
.
#${cleanTag(brandName)} ${nicheTags.map((t) => `#${t}`).join(' ')} #reelsinstagram #cinematicstage #viralreels #choreography #artistry
    `.trim();

    const instagram: PlatformMetadata = {
      caption: instagramCaption,
      hashtags: [cleanTag(brandName), ...nicheTags, 'reelsinstagram', 'cinematicstage', 'choreography'],
      recommendedTime: '18:15 (6:15 PM)',
      cta: `Double-tap and follow ${handle} for more!`,
      aiDisclosure: true,
    };

    // TikTok Adaptation
    const tiktokCaption = `${script.hook} Watch till the end for the reveal! Follow ${handle} 🎭 #${cleanTag(brandName)} ${nicheTags.map((t) => `#${t}`).join(' ')} #fyp #viral #stageperformance`;

    const tiktok: PlatformMetadata = {
      caption: tiktokCaption.slice(0, 1000),
      hashtags: [cleanTag(brandName), ...nicheTags, 'fyp', 'viral', 'stageperformance'],
      recommendedTime: '18:30 (6:30 PM)',
      cta: 'Follow for Part 2!',
      aiDisclosure: true,
    };

    return {
      youtube,
      instagram,
      tiktok,
    };
  }
}
