-- Auravo Studio - Migration 010: Canonical Default INSERT Protection & Database Integrity Hardening
-- Enforces database-level protection against direct SQL INSERT of canonical system defaults or seed keys.
-- Ensures that only authorized forward migrations can insert or modify trusted canonical defaults.
-- Preserves standard authenticated CRUD for user-owned private records (isSystemDefault = 0, seedKey IS NULL).

CREATE TRIGGER IF NOT EXISTS trg_rag_prevent_canonical_insert
BEFORE INSERT ON rag_knowledge
FOR EACH ROW
WHEN (NEW.isSystemDefault = 1 OR NEW.seedKey IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Direct insertion of canonical system defaults or seed keys is prohibited; canonical defaults can only be established through authorized forward migrations');
END;

