-- Migration 013: Motion Studio Saved Character Animations
-- Strictly additive migration preserving all existing tables and data

CREATE TABLE IF NOT EXISTS character_animations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brandId INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  characterId INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  preset TEXT NOT NULL,
  description TEXT,
  durationSec REAL NOT NULL,
  fps INTEGER NOT NULL DEFAULT 30,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  videoUrl TEXT NOT NULL,
  thumbnailUrl TEXT,
  sha256 TEXT NOT NULL,
  fileSize INTEGER NOT NULL,
  modelUsed TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_character_animations_owner ON character_animations(ownerId);
CREATE INDEX IF NOT EXISTS idx_character_animations_char ON character_animations(characterId);
CREATE INDEX IF NOT EXISTS idx_character_animations_brand ON character_animations(brandId);

