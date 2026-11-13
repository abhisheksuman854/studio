-- Migration 005: Character Entity with Identity Consistency and Generation Metadata

ALTER TABLE characters ADD COLUMN referenceImage TEXT;
ALTER TABLE characters ADD COLUMN generationModel TEXT DEFAULT 'SDXL_LIGHTNING';
ALTER TABLE characters ADD COLUMN generationParameters TEXT DEFAULT '{}';
ALTER TABLE characters ADD COLUMN identityTokens TEXT DEFAULT '[]';
ALTER TABLE characters ADD COLUMN metadata TEXT DEFAULT '{}';
ALTER TABLE characters ADD COLUMN updatedAt TEXT;

CREATE INDEX IF NOT EXISTS idx_characters_brand ON characters(brandId);
CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(ownerId);
