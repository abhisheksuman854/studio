-- Auravo Studio - Migration 007: RAG Security Stabilization & Tenant Isolation
-- Adds ownerId, isSystemDefault, and isQuarantined columns to rag_knowledge.
-- Fails closed: any pre-existing legacy record has unknown provenance and is safely quarantined.
-- Canonical defaults are populated with immutable seedKeys in Migration 008.

ALTER TABLE rag_knowledge ADD COLUMN ownerId INTEGER REFERENCES users(id);
ALTER TABLE rag_knowledge ADD COLUMN isSystemDefault INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rag_knowledge ADD COLUMN isQuarantined INTEGER NOT NULL DEFAULT 0;

-- Fail-closed: all legacy records lacking verified provenance are quarantined.
-- No legacy record is ever promoted to a system default based on title.
UPDATE rag_knowledge
SET isQuarantined = 1, isSystemDefault = 0
WHERE isSystemDefault = 0;

-- Indexes for high-performance tenant-isolated queries
CREATE INDEX IF NOT EXISTS idx_rag_owner ON rag_knowledge(ownerId);
CREATE INDEX IF NOT EXISTS idx_rag_system_default ON rag_knowledge(isSystemDefault);
CREATE INDEX IF NOT EXISTS idx_rag_quarantine ON rag_knowledge(isQuarantined);
CREATE INDEX IF NOT EXISTS idx_rag_tenant_lookup ON rag_knowledge(ownerId, isSystemDefault, isQuarantined);

