import { openDb } from '../server/db.js';
import { DANCER_ARCHETYPES } from '../server/content_engine.js';

const db = openDb(process.env.DATABASE_PATH ?? './data/studio.db');

const user = db.prepare('SELECT id, email FROM users ORDER BY id ASC LIMIT 1').get() as { id: number; email: string } | undefined;

if (!user) {
  console.error('No user found! Please register an account first in the browser.');
  process.exit(1);
}

console.log(`Setting up starter studio data for user: ${user.email} (ID: ${user.id})`);

// 1. Create Audience Profile
let audienceProfile = db.prepare('SELECT id FROM audience_profiles WHERE ownerId=? AND name=?').get(user.id, 'Global Dance & Music Viral Enthusiasts') as { id: number } | undefined;

if (!audienceProfile) {
  const info = db.prepare(`
    INSERT INTO audience_profiles (ownerId, name, ageMin, ageMax, country, language, interests, preferredDurationSec, tone, avoid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    'Global Dance & Music Viral Enthusiasts',
    18,
    34,
    'Global / India / US',
    'English & Hindi',
    JSON.stringify(['Bollywood Dance', 'K-Pop Choreography', 'Afro-Fusion', 'Viral Reels', 'Stage Performance']),
    '45',
    'energetic, inspiring, stylish, rhythmic',
    JSON.stringify(['monotonous talking heads', 'low quality video', 'cluttered backgrounds'])
  );
  audienceProfile = { id: Number(info.lastInsertRowid) };
  console.log(`Created Audience Profile with ID: ${audienceProfile.id}`);
} else {
  console.log(`Audience Profile exists with ID: ${audienceProfile.id}`);
}

// 2. Create Brand
let brand = db.prepare('SELECT id, name FROM brands WHERE ownerId=? LIMIT 1').get(user.id) as { id: number; name: string } | undefined;

if (!brand) {
  const info = db.prepare(`
    INSERT INTO brands (
      ownerId, name, handle, description, targetAgeMin, targetAgeMax, targetGender,
      country, language, secondaryLanguages, niche, audienceProfileId, tone,
      visualStyle, contentRules, prohibitedTopics, preferredTopics, postingFrequency, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    'Auravo Dance Studio',
    'auravo.studio',
    'Autonomous Multi-Brand Vertical Dance & Music Short-Form Studio producing high-energy rhythmic choreographies and viral reels.',
    18,
    35,
    'All',
    'Global',
    'English',
    JSON.stringify(['Hindi', 'Spanish']),
    'Entertainment, AI Choreography & Visual Music Shorts',
    audienceProfile.id,
    'high-energy, charismatic, regal, cinematic',
    'Chiaroscuro stage lighting, 9:16 vertical luxury aesthetic, neon rim lights, 8k crisp details',
    'Keep hooks within the first 3 seconds, synchronize choreography beats, maintain high emotional expression',
    JSON.stringify(['explicit nudity', 'political controversy', 'copyright violations']),
    JSON.stringify(['Bollywood Monsoon Fusion', 'High-Heels Commercial', 'Afro-Beats Rhythm', 'Cyberpunk K-Pop Stage']),
    'DAILY',
    1
  );
  brand = { id: Number(info.lastInsertRowid), name: 'Auravo Dance Studio' };
  console.log(`Created Brand: "${brand.name}" (ID: ${brand.id})`);
} else {
  console.log(`Brand already exists: "${brand.name}" (ID: ${brand.id})`);
}

// 3. Adopt All 7 Dancer Archetypes for this Brand
let adoptedCount = 0;
for (const arc of DANCER_ARCHETYPES) {
  const exists = db.prepare('SELECT id FROM characters WHERE brandId=? AND ownerId=? AND name=?').get(brand.id, user.id, arc.name);
  if (!exists) {
    db.prepare(`
      INSERT INTO characters (
        ownerId, brandId, name, description, age, personality, appearance,
        clothingStyle, visualPrompt, negativePrompt, voiceStyle
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
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
    adoptedCount++;
    console.log(`  + Adopted dancer: ${arc.name}`);
  }
}
console.log(`Adopted ${adoptedCount} new dancers (Total available: ${DANCER_ARCHETYPES.length}).`);

// 4. Seed Curated Content Ideas
const existingIdeasCount = (db.prepare('SELECT count(*) c FROM content_ideas WHERE brandId=? AND ownerId=?').get(brand.id, user.id) as { c: number }).c;

if (existingIdeasCount === 0) {
  const ideas = [
    {
      title: 'Monsoon Rhythm: The Peacock Gateway',
      premise: 'A regal Indian classical fusion choreography opening under heavy monsoon rain droplets with glowing palace torches, escalating into rapid footwork.',
      category: 'Choreography Fusion',
      potentialScore: 94,
      originalityScore: 92,
      visualPotentialScore: 96,
      difficulty: 'MEDIUM',
      status: 'DISCOVERED',
      audienceFit: 'High virality for vertical reels, strong visual hook in first 2 seconds.',
      tags: JSON.stringify(['#Bollywood', '#FusionDance', '#MonsoonBeats', '#VerticalReel']),
    },
    {
      title: 'Neon Cyberpunk K-Pop Solo Break',
      premise: 'Futuristic lavender and chrome visual aesthetic with razor-sharp high-heels choreography in a rain-slicked Tokyo alleyway.',
      category: 'K-Pop Stage',
      potentialScore: 91,
      originalityScore: 89,
      visualPotentialScore: 95,
      difficulty: 'MEDIUM',
      status: 'DISCOVERED',
      audienceFit: 'Popular with Gen-Z dance trend followers and music fans.',
      tags: JSON.stringify(['#KPopDance', '#NeonAesthetic', '#CyberChoreography', '#DanceShorts']),
    },
    {
      title: 'Crimson Velvet: Midnight Tango Cadence',
      premise: 'High-contrast dramatic side-lighting catches the fluid motion of a midnight crimson gown transitioning into fiery rhythmic spins.',
      category: 'Latin & Tango',
      potentialScore: 88,
      originalityScore: 93,
      visualPotentialScore: 90,
      difficulty: 'LOW',
      status: 'DISCOVERED',
      audienceFit: 'High aesthetic engagement, emotional storytelling cadence.',
      tags: JSON.stringify(['#Flamenco', '#TangoVibes', '#DramaticLighting', '#ReelsViral']),
    },
    {
      title: 'Afro-Goddess Royal Beat Drop',
      premise: 'Deep melanin beauty crowned in gold cuffs commanding the stage to polyrhythmic African drum loops with explosive fluid isolations.',
      category: 'Afro-Fusion',
      potentialScore: 95,
      originalityScore: 96,
      visualPotentialScore: 94,
      difficulty: 'MEDIUM',
      status: 'DISCOVERED',
      audienceFit: 'Exceptional retention rate with rapid rhythm progression.',
      tags: JSON.stringify(['#AfroBeats', '#AfroDance', '#RoyalEnergy', '#ViralAudio']),
    },
  ];

  for (const idea of ideas) {
    db.prepare(`
      INSERT INTO content_ideas (
        ownerId, brandId, title, premise, category, potentialScore, originalityScore,
        visualPotentialScore, difficulty, status, audienceFit, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      brand.id,
      idea.title,
      idea.premise,
      idea.category,
      idea.potentialScore,
      idea.originalityScore,
      idea.visualPotentialScore,
      idea.difficulty,
      idea.status,
      idea.audienceFit,
      idea.tags
    );
  }
  console.log(`Seeded ${ideas.length} curated viral content ideas.`);
}

// 5. Seed Starter 5-Beat Project in "Script & Video Studio" if empty
const existingContentCount = (db.prepare('SELECT count(*) c FROM content_items WHERE brandId=? AND ownerId=?').get(brand.id, user.id) as { c: number }).c;

if (existingContentCount === 0) {
  const priyaChar = db.prepare('SELECT id, name FROM characters WHERE brandId=? AND ownerId=? AND name LIKE ?').get(brand.id, user.id, '%Priya%') as any;

  const itemRes = db.prepare(`
    INSERT INTO content_items(ownerId, brandId, title, topic, status, aiGenerated)
    VALUES (?, ?, ?, ?, 'DRAFT', 1)
  `).run(
    user.id,
    brand.id,
    'Monsoon Rhythm: The Peacock Gateway',
    'Choreography Fusion'
  );
  const contentItemId = Number(itemRes.lastInsertRowid);

  const scriptRes = db.prepare(`
    INSERT INTO scripts(ownerId, contentItemId, brandId, title, hook, premise, targetDurationSec, language, tone, endingType)
    VALUES (?, ?, ?, ?, ?, ?, 45, 'English', 'regal, rhythmic, high-energy', 'Rewatch hook & Subscribe CTA')
  `).run(
    user.id,
    contentItemId,
    brand.id,
    'Auravo — Monsoon Rhythm: The Peacock Gateway',
    'When the first heavy monsoon raindrop strikes the courtyard floor, the temple bells begin to echo.',
    'A regal Indian classical fusion choreography opening under heavy monsoon rain droplets with glowing palace torches, escalating into rapid footwork.'
  );
  const scriptId = Number(scriptRes.lastInsertRowid);

  const starterScenes = [
    {
      sceneOrder: 1,
      durationSec: 6,
      narration: 'When the first heavy monsoon raindrop strikes the courtyard floor, the temple bells begin to echo.',
      visualPrompt: 'Vertical 9:16, dark ancient palace courtyard, torrential monsoon rain illuminated by golden torches, Priya the Royal Desi Siren standing poised under stone archway in peacock-blue silk lehenga, slow-motion water droplets, 8k vertical.',
      voiceDirection: 'Whispered, mysterious, cinematic cadence with thunder rumble',
      soundEffects: 'Heavy rain, distant temple bell resonance',
      musicDirection: 'Soft sitar drone with gentle raindrops',
      endingType: 'Hook hit',
    },
    {
      sceneOrder: 2,
      durationSec: 10,
      narration: 'Every step was counted in the shadows. But tonight, the rhythmic cadence ignites the night.',
      visualPrompt: 'Vertical 9:16, tight mid-shot of Priya executing intricate mudras and expressive eye isolations, warm golden rim reflections on peacock silk and gold jewelry, dramatic chiaroscuro contrast.',
      voiceDirection: 'Building pace, regal, confident',
      soundEffects: 'Ghungroo bell anklet strike on wet marble',
      musicDirection: 'Syncopated tabla rhythm entering softly',
      endingType: 'Build',
    },
    {
      sceneOrder: 3,
      durationSec: 12,
      narration: 'As the rhythm accelerates, classical grace explodes into contemporary high-energy power.',
      visualPrompt: 'Vertical 9:16, dynamic wide spin capturing billowing peacock-blue silk ripples and water splashes flying in circular arcs, vivid stage torches glowing in rain, cinematic motion blur.',
      voiceDirection: 'Energetic, elevated intensity, rhythmic flow',
      soundEffects: 'Splash impact whoosh, crescendo percussive roll',
      musicDirection: 'Full Bollywood monsoon beat drop with soaring bansuri flute',
      endingType: 'Climax',
    },
    {
      sceneOrder: 4,
      durationSec: 9,
      narration: 'In that single heartbeat between the thunder and the beat, the mystery was unveiled.',
      visualPrompt: 'Vertical 9:16, dramatic freeze-frame pose, Priya with hands raised in peacock mudra, water droplets suspended in air around her silhouette, intense eye contact with lens.',
      voiceDirection: 'Climactic whisper fading into awe',
      soundEffects: 'Resonant bronze gong strike, thunderclap',
      musicDirection: 'Sudden melodic suspension with ringing echo',
      endingType: 'Reveal',
    },
    {
      sceneOrder: 5,
      durationSec: 8,
      narration: 'Did you catch the footwork transition at beat three? Replay to see it, and follow Auravo for tomorrow night’s solo.',
      visualPrompt: 'Vertical 9:16, closing title card with Priya smiling gracefully against glowing palace torches, Auravo Studio branding emblem, golden embers rising in the rain.',
      voiceDirection: 'Smooth, warm sign-off and call to action',
      soundEffects: 'Soft rain outro, chime',
      musicDirection: 'Resolving melodic outro chord',
      endingType: 'Rewatch hook & Subscribe CTA',
    },
  ];

  for (const sc of starterScenes) {
    db.prepare(`
      INSERT INTO scenes(scriptId, sceneOrder, durationSec, narration, visualPrompt, voiceDirection, soundEffects, musicDirection, endingType)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scriptId,
      sc.sceneOrder,
      sc.durationSec,
      sc.narration,
      sc.visualPrompt,
      sc.voiceDirection,
      sc.soundEffects,
      sc.musicDirection,
      sc.endingType
    );
  }

  // Update idea status to APPROVED
  const firstIdea = db.prepare('SELECT id FROM content_ideas WHERE brandId=? ORDER BY id ASC LIMIT 1').get(brand.id) as { id: number } | undefined;
  if (firstIdea) {
    db.prepare('UPDATE content_ideas SET status=? WHERE id=?').run('APPROVED', firstIdea.id);
  }

  console.log(`Created starter 5-beat story project "#${contentItemId} · Monsoon Rhythm: The Peacock Gateway" with ${starterScenes.length} scenes.`);
}

console.log('✅ Setup & starter data seeding complete!');
