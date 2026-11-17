-- Phase 2.3.1.1: Canonical index alignment and composite indexing for resource_reservations
-- Ensures index naming follows repository standard (idx_<tableName>_<columnName>)
-- and provides composite indexing for (resourceType, status) queries.

CREATE INDEX IF NOT EXISTS idx_resource_reservations_status ON resource_reservations(status);
CREATE INDEX IF NOT EXISTS idx_resource_reservations_owner ON resource_reservations(ownerId);
CREATE INDEX IF NOT EXISTS idx_resource_reservations_type_status ON resource_reservations(resourceType, status);

