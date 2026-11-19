-- Migration 014: Video Studio Saved Composed Videos
-- Strictly additive migration preserving all existing tables and data

CREATE TABLE IF NOT EXISTS character_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brandId INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  characterId INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  animationId INTEGER NOT NULL REFERENCES character_animations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  aspectRatio TEXT NOT NULL,
  resolution TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  durationSec REAL NOT NULL,
  fps INTEGER NOT NULL DEFAULT 30,
  videoUrl TEXT NOT NULL,
  thumbnailUrl TEXT,
  sha256 TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  compositionConfig TEXT DEFAULT '{}',
  audioConfig TEXT DEFAULT '{}',
  subtitleConfig TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_character_videos_owner ON character_videos(ownerId);
CREATE INDEX IF NOT EXISTS idx_character_videos_char ON character_videos(characterId);
CREATE INDEX IF NOT EXISTS idx_character_videos_anim ON character_videos(animationId);
CREATE INDEX IF NOT EXISTS idx_character_videos_brand ON character_videos(brandId);

