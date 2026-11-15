-- Auravo Studio - Migration 008: RAG Provenance Hardening & Seed Verification
-- Enforces immutable application-owned provenance using stable seedKey values.
-- Does NOT infer provenance from mutable titles, categories, or contents.
-- Does NOT promote any legacy record; inserts canonical defaults with unique seedKeys.

ALTER TABLE rag_knowledge ADD COLUMN seedKey TEXT;

-- 1. Unique partial index to guarantee exactly one instance of each canonical seedKey
CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_seed_key ON rag_knowledge(seedKey) WHERE seedKey IS NOT NULL;

-- 2. De-promote any record previously classified as isSystemDefault that lacks a verified seedKey
-- (Reconciles existing databases where legacy Migration 007 may have previously run)
UPDATE rag_knowledge
SET isSystemDefault = 0
WHERE isSystemDefault = 1 AND seedKey IS NULL AND ownerId IS NOT NULL;

UPDATE rag_knowledge
SET isSystemDefault = 0, isQuarantined = 1
WHERE isSystemDefault = 1 AND seedKey IS NULL AND ownerId IS NULL;

-- 3. Insert canonical application-owned defaults directly with immutable seedKeys
-- Using INSERT OR IGNORE to remain fully idempotent on databases where seeds already exist
INSERT OR IGNORE INTO rag_knowledge (seedKey, category, title, content, tags, metadata, ownerId, isSystemDefault, isQuarantined)
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

-- 4. Fail-closed: any non-canonical row with unknown ownership remains quarantined
UPDATE rag_knowledge
SET isQuarantined = 1, isSystemDefault = 0
WHERE seedKey IS NULL AND ownerId IS NULL;
