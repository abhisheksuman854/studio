CREATE TABLE IF NOT EXISTS characters(
  id INTEGER PRIMARY KEY,
  ownerId INTEGER NOT NULL REFERENCES users(id),
  brandId INTEGER NOT NULL REFERENCES brands(id),
  name TEXT NOT NULL,
  description TEXT,
  age INTEGER,
  personality TEXT,
  appearance TEXT,
  clothingStyle TEXT,
  visualPrompt TEXT,
  negativePrompt TEXT,
  voiceStyle TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS content_ideas(
  id INTEGER PRIMARY KEY,
  ownerId INTEGER NOT NULL REFERENCES users(id),
  brandId INTEGER NOT NULL REFERENCES brands(id),
  title TEXT NOT NULL,
  premise TEXT NOT NULL,
  category TEXT NOT NULL,
  potentialScore INTEGER NOT NULL,
  originalityScore INTEGER NOT NULL,
  visualPotentialScore INTEGER NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'DISCOVERED',
  audienceFit TEXT,
  tags TEXT DEFAULT '[]',
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scripts(
  id INTEGER PRIMARY KEY,
  ownerId INTEGER NOT NULL REFERENCES users(id),
  contentItemId INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  brandId INTEGER NOT NULL REFERENCES brands(id),
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  premise TEXT NOT NULL,
  targetDurationSec INTEGER NOT NULL DEFAULT 45,
  language TEXT NOT NULL DEFAULT 'English',
  tone TEXT,
  endingType TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scenes(
  id INTEGER PRIMARY KEY,
  scriptId INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  sceneOrder INTEGER NOT NULL,
  durationSec INTEGER NOT NULL DEFAULT 8,
  narration TEXT NOT NULL,
  dialogue TEXT,
  visualPrompt TEXT NOT NULL,
  voiceDirection TEXT,
  soundEffects TEXT,
  musicDirection TEXT,
  endingType TEXT
);

CREATE TABLE IF NOT EXISTS assets(
  id INTEGER PRIMARY KEY,
  ownerId INTEGER NOT NULL REFERENCES users(id),
  contentItemId INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  sceneId INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
  type TEXT NOT NULL, -- 'IMAGE', 'AUDIO', 'SUBTITLE', 'VIDEO', 'THUMBNAIL'
  provider TEXT NOT NULL,
  prompt TEXT,
  filePath TEXT NOT NULL,
  mimeType TEXT,
  metadata TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS originality_fingerprints(
  id INTEGER PRIMARY KEY,
  ownerId INTEGER NOT NULL REFERENCES users(id),
  brandId INTEGER NOT NULL REFERENCES brands(id),
  contentItemId INTEGER NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  premise TEXT NOT NULL,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
