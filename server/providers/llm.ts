import type { BrandContext, CharacterContext, GeneratedStory, GeneratedStoryScene, IdeaItem, LLMProvider } from './types.js';

export class LocalLLMProvider implements LLMProvider {
  async generateIdeas(brand: BrandContext, count = 5): Promise<IdeaItem[]> {
    const topics = brand.preferredTopics.length > 0
      ? brand.preferredTopics
      : ['Dramatic stage solo', 'The phantom choreography', 'Midnight overture', 'The golden velvet dress', 'Spotlight illusion'];

    const tones = brand.tone ? brand.tone.split(',').map((s) => s.trim()) : ['elegant', 'dramatic', 'mysterious'];
    const results: IdeaItem[] = [];

    const ideaTemplates = [
      {
        titleSuffix: 'The Hidden Tempo',
        premiseTpl: (t: string, b: string) => `A lone dancer on an empty illuminated stage discovers a secret musical tempo hidden behind the theater walls, leading to an impossible ${t} routine.`,
        cat: 'Choreography & Mystery',
        diff: 'MEDIUM' as const,
      },
      {
        titleSuffix: 'Shadow & Spotlight',
        premiseTpl: (t: string, b: string) => `When the main stage lights malfunction, an artist improvises a silhouette routine with dramatic side-lighting and ${t}, mesmerizing the unseen audience.`,
        cat: 'Stage Performance',
        diff: 'EASY' as const,
      },
      {
        titleSuffix: 'The Velvet Mask',
        premiseTpl: (t: string, b: string) => `An enigmatic performer wearing vintage stage attire executes a breathtaking sequence of syncopated movements before vanishing behind the red curtains.`,
        cat: 'Theatrical Drama',
        diff: 'MEDIUM' as const,
      },
      {
        titleSuffix: 'Overture at Midnight',
        premiseTpl: (t: string, b: string) => `An orchestra crescendo matches every subtle movement of a solo dancer, revealing an emotional tale of passion and precision in ${t}.`,
        cat: 'Music & Storytelling',
        diff: 'HARD' as const,
      },
      {
        titleSuffix: 'Echoes in the Wings',
        premiseTpl: (t: string, b: string) => `Backstage tension dissolves into a stunning display of rhythmic choreography under golden incandescent stage lamps.`,
        cat: 'Behind the Curtain',
        diff: 'MEDIUM' as const,
      },
      {
        titleSuffix: 'The Grand Finale Illusion',
        premiseTpl: (t: string, b: string) => `A dramatic climax where the choreography seems to defy gravity, creating a visual cliffhanger that leaves viewers rewatching.`,
        cat: 'Visual Spectacle',
        diff: 'HARD' as const,
      },
    ];

    for (let i = 0; i < count; i++) {
      const tpl = ideaTemplates[i % ideaTemplates.length];
      const selectedTopic = topics[i % topics.length];
      const randomTone = tones[i % tones.length];

      const potentialScore = 80 + Math.floor(Math.sin(i + 1) * 12 + 5);
      const originalityScore = 85 + Math.floor(Math.cos(i + 2) * 10 + 4);
      const visualPotentialScore = 88 + Math.floor(Math.sin(i * 3) * 8 + 3);

      results.push({
        title: `${brand.name || 'Studio'}: ${tpl.titleSuffix} (Vol. ${i + 1})`,
        premise: tpl.premiseTpl(selectedTopic, brand.name),
        category: tpl.cat,
        potentialScore: Math.min(99, Math.max(70, potentialScore)),
        originalityScore: Math.min(98, Math.max(75, originalityScore)),
        visualPotentialScore: Math.min(99, Math.max(80, visualPotentialScore)),
        difficulty: tpl.diff,
        audienceFit: `Targeted for age ${brand.targetAgeMin || 21}-${brand.targetAgeMax || 60} with interest in ${selectedTopic} and a ${randomTone} mood.`,
        tags: [selectedTopic, randomTone, tpl.cat, brand.niche || 'Entertainment'].slice(0, 4),
      });
    }

    return results;
  }

  async generateStory(brand: BrandContext, topic: string, customPremise?: string, character?: CharacterContext): Promise<GeneratedStory> {
    const title = `${brand.name || 'Studio'} — ${topic || 'The Stage Enigma'}`;
    const tone = brand.tone || 'elegant, confident, moody, sensual but classy';
    const visualStyle = brand.visualStyle || 'Dramatic stage lighting, deep shadows, rich textures, 9:16 vertical composition';

    const charDesc = character
      ? `${character.name}, a solo dancer with ${character.appearance || 'striking sculpted features and magnetic gaze'}, wearing ${character.clothingStyle || 'a midnight crimson silk gown'}, ${character.personality || 'confident and graceful'}`
      : `a world-class solo dancer in elegant theatrical stage attire`;

    const premise = customPremise || `An atmospheric 45-second performance featuring ${character?.name || 'the solo dancer'} uncovering a mesmerizing choreography piece under dramatic spotlighting, capturing intense suspense and artistry.`;

    const scenes: GeneratedStoryScene[] = [
      {
        sceneOrder: 1,
        durationSec: 5,
        narration: `They say the stage only reveals its true secret when the final spotlight cuts through the silence.`,
        visualPrompt: `Vertical 9:16, dark theater stage, single intense overhead golden spotlight cutting through atmospheric haze, ${charDesc} standing center stage in silhouette, cinematic contrast, 8k resolution, dramatic ${tone} aesthetic.`,
        voiceDirection: character?.voiceStyle || 'Intriguing, calm, low register, confident and magnetic',
        soundEffects: 'Distorted vinyl crackle, distant low bass hum, single stage light switch click',
        musicDirection: 'Slow atmospheric cello build with soft pulse',
      },
      {
        sceneOrder: 2,
        durationSec: 10,
        narration: `Every step was calculated. Every rhythm counted in the dark. But tonight, the tempo was completely different.`,
        visualPrompt: `Vertical 9:16, close-up shot of ${character?.name || 'the dancer'}'s intense gaze and fluid hand choreography, ${character?.clothingStyle || 'luxurious velvet and liquid silk'} catching dramatic rim lighting, moody shadows, ${visualStyle}.`,
        voiceDirection: character?.voiceStyle || 'Building pace, steady, sophisticated',
        soundEffects: 'Soft stage floor tap resonating, silk cloth rustle',
        musicDirection: 'Syncopated acoustic percussion entering softly',
      },
      {
        sceneOrder: 3,
        durationSec: 12,
        narration: `As the music accelerates, the boundaries between the dancer and the stage vanish into pure choreography.`,
        visualPrompt: `Vertical 9:16, full-body shot of ${character?.name || 'the dancer'} executing dynamic, high-precision dance movement, trailing motion blur, glowing ambient chandeliers, theatrical depth of field, ${tone}.`,
        voiceDirection: 'Energetic, elevated intensity, dramatic cadence',
        soundEffects: 'Crescendo whoosh, sharp brass accent hit',
        musicDirection: 'Full orchestral crescendo with modern rhythm beats',
      },
      {
        sceneOrder: 4,
        durationSec: 10,
        narration: `In that split second before the applause, the mystery came into full view.`,
        visualPrompt: `Vertical 9:16, striking high-angle freeze frame of ${character?.name || 'the dancer'} in a climax pose, dramatic backlight halo effect, floating golden dust particles in beam of light, ultra-crisp detail.`,
        voiceDirection: 'Climactic whisper fading into awe',
        soundEffects: 'Reverberant cymbal wash, sharp intake of breath',
        musicDirection: 'Sudden melodic suspension with lingering piano chord',
      },
      {
        sceneOrder: 5,
        durationSec: 8,
        narration: `Did you catch the hidden sequence? Replay and look closely at the third move. Follow ${brand.handle || brand.name || 'our channel'} for the next act.`,
        visualPrompt: `Vertical 9:16, sleek closing scene card featuring ${character?.name || 'the dancer'} with glowing minimalist emblem of ${brand.name}, stage curtains gently closing, subtle golden ember particles floating up.`,
        voiceDirection: 'Inviting, smooth call to action, memorable sign-off',
        soundEffects: 'Velvet curtain sweep, subtle notification chime',
        musicDirection: 'Warm resolving outro chord',
        endingType: 'Rewatch hook & Subscribe CTA',
      },
    ];

    const totalDuration = scenes.reduce((acc, s) => acc + s.durationSec, 0);

    return {
      title,
      hook: scenes[0].narration,
      premise,
      targetDurationSec: totalDuration,
      language: brand.language || 'English',
      tone,
      endingType: 'Cliffhanger CTA',
      scenes,
    };
  }
}
