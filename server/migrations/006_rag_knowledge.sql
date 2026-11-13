-- Auravo Studio V2 - Migration 006: Local RAG Knowledge Store
-- Stores choreography mudras, tempo patterns, viral hook frameworks, character consistency rules

CREATE TABLE IF NOT EXISTS rag_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, -- 'CHOREOGRAPHY', 'VIRAL_HOOKS', 'CHARACTER_CONSISTENCY', 'SAFETY_POLICY'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rag_category ON rag_knowledge(category);
CREATE INDEX IF NOT EXISTS idx_rag_title ON rag_knowledge(title);
