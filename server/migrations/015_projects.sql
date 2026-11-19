-- Migration 015: Projects Workflow Campaign Grouping
-- Strictly additive migration preserving all existing tables and data

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brandId INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  characterId INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  animationId INTEGER REFERENCES character_animations(id) ON DELETE SET NULL,
  videoId INTEGER REFERENCES character_videos(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'ACTIVE',
  metadata TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(ownerId);
CREATE INDEX IF NOT EXISTS idx_projects_brand ON projects(brandId);
CREATE INDEX IF NOT EXISTS idx_projects_char ON projects(characterId);

