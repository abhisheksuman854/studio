-- Auravo Studio - Migration 009: Forward RAG Provenance Reconciliation & Database Integrity Hardening
-- Enforces fail-closed reconciliation across ALL historical database migration states,
-- including databases that previously applied original Migration 007 and original Migration 008.
-- 1. Preserves all pre-existing records and content.
-- 2. Preserves surviving user ownership (ownerId); never fabricates or reassigns ownership.
-- 3. Clears untrusted historical seedKey assignments and de-promotes/quarantines untrusted rows.
-- 4. Inserts fresh, independently verified canonical application defaults with unique seedKeys.
-- 5. Enforces database-level immutability for canonical defaults via SQLite triggers.

-- Step 1: Ensure unique partial index on seedKey exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_seed_key ON rag_knowledge(seedKey) WHERE seedKey IS NOT NULL;

-- Step 2: Fail-closed reconciliation of all pre-existing rows.
-- Pre-existing rows that claim system default status, carry historical seedKeys, or lack ownership
-- are untrusted because original Migration 008 used content/title matching.
-- We strip historical seedKeys, de-promote system defaults to 0, and quarantine unowned rows.
-- User-owned private records (ownerId IS NOT NULL) retain their ownerId and are quarantined if they held untrusted seedKeys.
UPDATE rag_knowledge
SET isSystemDefault = 0,
    isQuarantined = 1,
    seedKey = NULL
WHERE seedKey IS NOT NULL OR isSystemDefault = 1 OR ownerId IS NULL;

-- Step 3: Insert fresh, verified canonical application defaults with immutable seedKeys
INSERT INTO rag_knowledge (seedKey, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
VALUES
  (
    'canonical_v1_alapadma_mudra',
    'CHOREOGRAPHY',
    'Alapadma Mudra (Blooming Lotus)',
    'Full blooming lotus hand gesture with all fingers separated and gracefully curved outward. Symbolizes beauty, blooming grace, and dramatic revelation. In video prompts: "hands formed in precise Alapadma blooming lotus gesture, fingers delicately splayed".',
    '["alapadma","lotus","mudra","kathak","bharatanatyam","indian","classical","grace"]',
    '{"origin":"Indo-Classical","visualAnchor":"hands"}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_mayura_mudra',
    'CHOREOGRAPHY',
    'Mayura Mudra (Peacock Grace)',
    'The peacock mudra formed by pressing the ring finger to the thumb tip while keeping other fingers extended straight. Evokes regal royalty, monsoon rain, and proud carriage. In video prompts: "regal posture with hands in Mayura peacock gesture, serene expression".',
    '["mayura","peacock","mudra","monsoon","royalty","classical","indian"]',
    '{"origin":"Indo-Classical","visualAnchor":"hands"}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_kathak_chakkars',
    'CHOREOGRAPHY',
    'Kathak Chakkars (High-Speed Pirouettes)',
    'Rapid spins performed on the heel and ball of the foot with sharp focal spotting. Causes silk anarkali skirts and flared fabric to fan out into a dramatic 360-degree radial cone. In video prompts: "mid-spin Kathak chakkar pirouette, flared circular silk hem billowing with rotational blur".',
    '["kathak","spin","chakkar","pirouette","anarkali","silk","flair","rotation"]',
    '{"origin":"Kathak","visualAnchor":"spin"}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_flamenco_zapateado',
    'CHOREOGRAPHY',
    'Flamenco Zapateado (Syncopated Footwork)',
    'Rhythmic, percussive foot percussion where the dancer strikes the floor with the shoe tip, ball, and heel in complex counter-time polyrhythms. In video prompts: "intense Flamenco zapateado footwork, arched torso, sharp castanet posture under amber stage lights".',
    '["flamenco","zapateado","footwork","rhythm","percussive","spanish","latina"]',
    '{"origin":"Flamenco","visualAnchor":"footwork"}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_afro_fusion_torso',
    'CHOREOGRAPHY',
    'Afro-Fusion Torso & Shoulder Ripple',
    'Poly-rhythmic spinal wave and rapid shoulder isolations synchronized to syncopated polyrhythms and sub-bass kicks. In video prompts: "dynamic Afro-fusion shoulder isolation and spinal wave, powerful grounded center of gravity".',
    '["afro","afrobeats","isolation","ripple","polyrhythm","grounded","energy"]',
    '{"origin":"Afro-Fusion","visualAnchor":"torso"}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_contemporary_gravity',
    'CHOREOGRAPHY',
    'Contemporary Gravity Suspension & Drop',
    'The dancer leaps into a high vertical extension, appears suspended at apex for a split second, then collapses gracefully into a fluid floor slide. In video prompts: "apex zero-gravity leap suspension, followed by an elegant liquid floor surrender".',
    '["contemporary","leap","suspension","floorwork","gravity","ballet"]',
    '{"origin":"Contemporary","visualAnchor":"leap"}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_unbroken_eye_contact',
    'VIRAL_HOOKS',
    'The Unbroken Eye Contact Pivot',
    'First 2 seconds: character maintains hypnotic unbroken eye contact directly into camera while the music suddenly drops to a muffled heartbeat pulse before an explosive beat drop.',
    '["hook","eye contact","gaze","retention","viral","suspense","beat drop"]',
    '{"retentionMultiplier":1.45}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_silhouette_spotlight',
    'VIRAL_HOOKS',
    'The Silhouette-to-Spotlight Reveal',
    'First 3 seconds: extreme high-contrast black silhouette under backlight haze. At beat 3, an intense golden overhead spotlight illuminates the face and signature costume simultaneously.',
    '["hook","silhouette","spotlight","reveal","lighting","contrast"]',
    '{"retentionMultiplier":1.38}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_impossible_accelerando',
    'VIRAL_HOOKS',
    'The Impossible Accelerando',
    'The choreography starts at slow, hypnotic half-tempo, and abruptly doubles tempo every 4 beats, creating an overwhelming crescendo of speed and visual precision.',
    '["hook","tempo","speed","crescendo","fast","accelerando"]',
    '{"retentionMultiplier":1.52}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_facial_token_anchor',
    'CHARACTER_CONSISTENCY',
    'Facial Token Anchor Hierarchy',
    'Always place locked facial identity tokens (e.g. eye color, cheekbones, hair texture) BEFORE environmental and lighting keywords. Negative prompts must explicitly forbid "face distortion, multiple faces, morphing, cartoon".',
    '["consistency","tokens","face","identity","prompting","anchor"]',
    '{"priority":"CRITICAL"}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_attire_fabric_stability',
    'CHARACTER_CONSISTENCY',
    'Attire & Fabric Stability Directive',
    'Keep fabric descriptions consistent across scenes (e.g. "midnight sapphire silk anarkali with gold embroidery"). Specifying the same weave and color ensures stable texture rendering without dress switching.',
    '["costume","fabric","anarkali","silk","consistency","color"]',
    '{"priority":"HIGH"}',
    NULL, 1, 0
  ),
  (
    'canonical_v1_luxury_dance_decorum',
    'SAFETY_POLICY',
    'Luxury Dance Decorum Standard',
    'All dance costumes must maintain luxury stage decorum with full lining. Avoid sheer or see-through without opaque backing. Maintain athletic and artistic classical integrity at all times.',
    '["safety","policy","compliance","decorum","costume","guidelines"]',
    '{"enforcement":"STRICT"}',
    NULL, 1, 0
  );

-- Step 4: Strict invariant verification within the migration transaction
-- If any invariant fails, the CHECK constraint will fail and roll back the transaction.
CREATE TEMP TABLE _migration_009_invariant_check (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO _migration_009_invariant_check (ok)
SELECT
  CASE
    -- Invariant 1: Exactly 12 system defaults exist
    WHEN (SELECT COUNT(*) FROM rag_knowledge WHERE isSystemDefault = 1) != 12 THEN 0
    -- Invariant 2: Exactly 12 distinct seedKey values exist
    WHEN (SELECT COUNT(DISTINCT seedKey) FROM rag_knowledge WHERE seedKey IS NOT NULL) != 12 THEN 0
    -- Invariant 3: All 12 system defaults are not quarantined, unowned, and have a non-null seedKey
    WHEN (SELECT COUNT(*) FROM rag_knowledge WHERE isSystemDefault = 1 AND (isQuarantined != 0 OR ownerId IS NOT NULL OR seedKey IS NULL)) != 0 THEN 0
    -- Invariant 4: No non-system-default row has a seedKey
    WHEN (SELECT COUNT(*) FROM rag_knowledge WHERE seedKey IS NOT NULL AND isSystemDefault != 1) != 0 THEN 0
    -- Invariant 5: All 12 specific canonical seed keys are present
    WHEN (SELECT COUNT(*) FROM rag_knowledge WHERE seedKey IN (
      'canonical_v1_alapadma_mudra',
      'canonical_v1_mayura_mudra',
      'canonical_v1_kathak_chakkars',
      'canonical_v1_flamenco_zapateado',
      'canonical_v1_afro_fusion_torso',
      'canonical_v1_contemporary_gravity',
      'canonical_v1_unbroken_eye_contact',
      'canonical_v1_silhouette_spotlight',
      'canonical_v1_impossible_accelerando',
      'canonical_v1_facial_token_anchor',
      'canonical_v1_attire_fabric_stability',
      'canonical_v1_luxury_dance_decorum'
    )) != 12 THEN 0
    -- Invariant 6: No unowned row is left unquarantined unless it is a verified canonical default
    WHEN (SELECT COUNT(*) FROM rag_knowledge WHERE ownerId IS NULL AND isSystemDefault = 0 AND isQuarantined = 0) != 0 THEN 0
    -- Invariant 7: No quarantined row has a seedKey or is marked as system default
    WHEN (SELECT COUNT(*) FROM rag_knowledge WHERE isQuarantined = 1 AND (isSystemDefault != 0 OR seedKey IS NOT NULL)) != 0 THEN 0
    ELSE 1
  END;

DROP TABLE _migration_009_invariant_check;

-- Step 5: Install SQLite database triggers to protect canonical defaults from modification or deletion
-- Trigger 1: Prevent updates to any canonical system default row
CREATE TRIGGER IF NOT EXISTS trg_rag_protect_canonical_update
BEFORE UPDATE ON rag_knowledge
FOR EACH ROW
WHEN (OLD.isSystemDefault = 1 OR OLD.seedKey IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Canonical system default knowledge items are immutable and cannot be updated');
END;

-- Trigger 2: Prevent promotion of private rows or assignment of seedKey via update
CREATE TRIGGER IF NOT EXISTS trg_rag_prevent_user_promotion_update
BEFORE UPDATE ON rag_knowledge
FOR EACH ROW
WHEN (OLD.isSystemDefault = 0 AND (NEW.isSystemDefault = 1 OR NEW.seedKey IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'Cannot promote private knowledge items to system defaults or assign seed keys');
END;

-- Trigger 3: Prevent deletion of any canonical system default row
CREATE TRIGGER IF NOT EXISTS trg_rag_protect_canonical_delete
BEFORE DELETE ON rag_knowledge
FOR EACH ROW
WHEN (OLD.isSystemDefault = 1 OR OLD.seedKey IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Canonical system default knowledge items cannot be deleted');
END;

