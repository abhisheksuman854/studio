-- Phase 2.3.1: Resource Coordinator Core & Safe Admission Control
-- Creates persistent ledger for local runtime resource reservations.

CREATE TABLE IF NOT EXISTS resource_reservations(
  id TEXT PRIMARY KEY,
  resourceType TEXT NOT NULL, -- 'LLM', 'SDXL', 'CPU_VIDEO_RENDER', 'AUDIO_PROCESSING'
  ownerId TEXT NOT NULL,
  status TEXT NOT NULL, -- 'REQUESTED', 'LOADING', 'ACTIVE', 'DRAINING', 'UNLOADING', 'VERIFYING_RELEASE', 'RELEASED', 'FAILED', 'RECOVERY_REQUIRED', 'CANCELLED', 'TIMED_OUT'
  pid INTEGER,
  acquiredAt INTEGER NOT NULL,
  lastHeartbeatAt INTEGER NOT NULL,
  releasedAt INTEGER,
  failureReason TEXT,
  metadata TEXT DEFAULT '{}',
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_res_resv_status ON resource_reservations(status);
CREATE INDEX IF NOT EXISTS idx_res_resv_owner ON resource_reservations(ownerId);
CREATE INDEX IF NOT EXISTS idx_res_resv_type ON resource_reservations(resourceType);
