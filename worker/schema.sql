-- iAny Radio (D1). Apply once:
--   npx wrangler d1 execute iany-radio --remote --file worker/schema.sql
-- See docs/RADIO-KHMER.md.

CREATE TABLE IF NOT EXISTS outlets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL,          -- SHA-256(token); the plaintext is shown once
  verified    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outlets_token ON outlets (token_hash);

CREATE TABLE IF NOT EXISTS news (
  id          TEXT PRIMARY KEY,
  outlet_id   TEXT NOT NULL,
  outlet_name TEXT NOT NULL,          -- denormalized so the app always attributes
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,          -- Khmer; foreign words transliterated (enforced)
  tts_title   TEXT,                   -- word-segmented (ICU) copy read aloud by the voice
  tts_body    TEXT,                   -- "" (display uses the clean title/body)
  sponsor     TEXT,
  lang        TEXT NOT NULL DEFAULT 'km',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL           -- created_at + 7 days; cron purges past this
);
-- Migration for an existing DB (columns added after launch; safe to run once):
--   ALTER TABLE news ADD COLUMN tts_title TEXT;
--   ALTER TABLE news ADD COLUMN tts_body  TEXT;
CREATE INDEX IF NOT EXISTS idx_news_created ON news (created_at);
CREATE INDEX IF NOT EXISTS idx_news_expires ON news (expires_at);

-- Crowd-sourced Khmer speech (the "Contribute your voice" screen). Each row is
-- one (audio, transcript) pair for training an open Khmer STT model; the WAV
-- lives in R2 at r2_key. speaker is an anonymous device id (never a name).
-- credit_name is opt-in, for the released dataset's contributor credits.
CREATE TABLE IF NOT EXISTS voice_clips (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 object key: voice/<yyyymmdd>/<id>.wav
  speaker     TEXT NOT NULL,          -- anonymous per-device id, e.g. s-3f9a2c71
  sentence    TEXT NOT NULL,          -- the exact prompt that was read
  sentence_id TEXT,                   -- prompt id from the bundled set
  lang        TEXT NOT NULL DEFAULT 'km',
  credit_name TEXT,                   -- opt-in public credit (dataset contributors)
  class_label TEXT,                   -- optional, e.g. "6A" (no personal names)
  gender      TEXT,                   -- optional, self-reported
  age_band    TEXT,                   -- optional
  region      TEXT,                   -- optional province/dialect
  duration_ms INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_created ON voice_clips (created_at);
CREATE INDEX IF NOT EXISTS idx_voice_speaker ON voice_clips (speaker);

-- Crowd-sourced Khmer OCR ("Contribute Khmer text photos", the /scan page).
-- Each row is one (image, transcript) pair for training an open Khmer OCR model.
-- The image lives in R2 at r2_key; `text` is the human-verified ground truth;
-- `ocr_guess` is what the current model read (lets us measure its error and
-- prioritise hard samples). credit_name is opt-in for the released credits.
CREATE TABLE IF NOT EXISTS ocr_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 object key: ocr/<yyyymmdd>/<id>.jpg
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. d-3f9a2c71
  text        TEXT NOT NULL,          -- human-verified Khmer transcript
  ocr_guess   TEXT,                   -- what the on-device model read (may differ)
  credit_name TEXT,                   -- opt-in public credit (dataset contributors)
  region      TEXT,                   -- optional province/dialect
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ocr_created ON ocr_samples (created_at);

-- Crowd-sourced Khmer Sign Language ("Contribute Khmer Sign Language", the
-- /sign page). Each row is one (label, hand-landmark sequence) pair for training
-- an open Khmer Sign Language recognition model. We store ONLY the landmark
-- sequence (a JSON array of per-frame 21-keypoint hand skeletons) in R2 at
-- r2_key — never the video, so a contributor can't be identified. `label` is the
-- Khmer word/letter signed; credit_name is opt-in for the released credits.
CREATE TABLE IF NOT EXISTS sign_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 object key: sign/<yyyymmdd>/<id>.json
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. g-3f9a2c71
  label       TEXT NOT NULL,          -- the Khmer word/letter that was signed
  prompt_id   TEXT,                   -- prompt id from the bundled set
  frames      INTEGER,                -- total frames in the sequence
  hand_frames INTEGER,                -- frames in which a hand was detected
  credit_name TEXT,                   -- opt-in public credit (dataset contributors)
  region      TEXT,                   -- optional province/dialect
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sign_created ON sign_samples (created_at);
CREATE INDEX IF NOT EXISTS idx_sign_label ON sign_samples (label);

-- Crowd-sourced crop photos (the /crop page). Each row is one (image, crop,
-- condition) sample for training an open, offline crop-health classifier
-- (MobileNetV3 — see docs/VISION-MOBILENET.md). The image lives in R2 at r2_key
-- (foldered crop/<crop>/<condition>/… so the prefix is already a labelled image
-- dataset); `crop` + `condition` are server-allowlisted label ids. `device` is an
-- anonymous per-device id; credit_name is opt-in for the released credits.
CREATE TABLE IF NOT EXISTS crop_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 object key: crop/<crop>/<condition>/<day>-<id>.jpg
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. c-3f9a2c71
  crop        TEXT NOT NULL,          -- crop id (rice, cassava, …)
  condition   TEXT NOT NULL,          -- healthy / disease / pest / deficiency / unsure
  note        TEXT,                   -- optional free-text (e.g. disease name if known)
  credit_name TEXT,                   -- opt-in public credit (dataset contributors)
  region      TEXT,                   -- optional province/dialect
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crop_created ON crop_samples (created_at);
CREATE INDEX IF NOT EXISTS idx_crop_crop ON crop_samples (crop);
CREATE INDEX IF NOT EXISTS idx_crop_condition ON crop_samples (condition);

-- Crowd-sourced rapid diagnostic test (RDT) strip photos (the /health-test page).
-- Each row is one (strip image, test type, result) sample for training an offline
-- model that READS the result line (positive/negative/invalid) — reading, not
-- diagnosing (see docs/HEALTH-AI.md). Privacy: the strip photo only — no faces,
-- names, or documents. Image in R2 at r2_key (foldered health-test/<test>/<result>/);
-- device is an anonymous per-device id; credit_name is opt-in.
CREATE TABLE IF NOT EXISTS health_test_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 key: health-test/<test>/<result>/<day>-<id>.jpg
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. h-3f9a2c71
  test        TEXT NOT NULL,          -- malaria / dengue / pregnancy / covid / other
  result      TEXT NOT NULL,          -- positive / negative / invalid  (classifier target)
  note        TEXT,
  credit_name TEXT,                   -- opt-in public credit (dataset contributors)
  region      TEXT,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_htest_created ON health_test_samples (created_at);
CREATE INDEX IF NOT EXISTS idx_htest_test ON health_test_samples (test);
CREATE INDEX IF NOT EXISTS idx_htest_result ON health_test_samples (result);

-- Crowd-sourced water-quality test-strip photos (the /water page). Each row is one
-- (strip image, test type, safety band) sample for training an offline reader that
-- maps a strip → safe / caution / unsafe — guidance, not a certified measurement
-- (see docs/ENVIRONMENT-AI.md). Water safety (esp. arsenic) is a rural-health issue.
-- Image in R2 at r2_key (foldered water/<test>/<level>/); device is anonymous;
-- credit_name is opt-in.
CREATE TABLE IF NOT EXISTS water_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 key: water/<test>/<level>/<day>-<id>.jpg
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. w-3f9a2c71
  test        TEXT NOT NULL,          -- arsenic / bacteria / ph / chlorine / nitrate / iron / other
  level       TEXT NOT NULL,          -- safe / caution / unsafe / unclear  (classifier target)
  source      TEXT,                   -- tubewell / dugwell / pond / rain / piped / bottled / other
  note        TEXT,
  credit_name TEXT,                   -- opt-in public credit (dataset contributors)
  region      TEXT,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_water_created ON water_samples (created_at);
CREATE INDEX IF NOT EXISTS idx_water_test ON water_samples (test);
CREATE INDEX IF NOT EXISTS idx_water_level ON water_samples (level);

-- Crowd-sourced waste/recyclable item photos (the /waste page). Each row is one
-- (image, material type) sample for training an offline waste-sorting classifier
-- (recycling education + sorting help; see docs/ENVIRONMENT-AI.md). Image in R2 at
-- r2_key (foldered waste/<type>/); device is anonymous; credit_name is opt-in.
CREATE TABLE IF NOT EXISTS waste_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 key: waste/<type>/<day>-<id>.jpg
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. r-3f9a2c71
  type        TEXT NOT NULL,          -- plastic_bottle / can / glass / paper / …  (classifier target)
  note        TEXT,
  credit_name TEXT,                   -- opt-in public credit (dataset contributors)
  region      TEXT,
  lat         REAL,                   -- optional GPS (litter mapping)
  lng         REAL,
  acc         INTEGER,                -- GPS accuracy radius (metres)
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waste_created ON waste_samples (created_at);
CREATE INDEX IF NOT EXISTS idx_waste_type ON waste_samples (type);
-- Migration for an existing DB (safe once): ALTER TABLE waste_samples ADD COLUMN lat REAL;
--   ALTER TABLE waste_samples ADD COLUMN lng REAL; ALTER TABLE waste_samples ADD COLUMN acc INTEGER;

-- Crowd-sourced nature photos (the /species page) — biodiversity + mosquito
-- (disease-vector) surveillance. `grp` (group) is the classifier target; `species`
-- is a free-text name (metadata); lat/lng is an optional sighting point. See
-- docs/ENVIRONMENT-AI.md. (`grp` not `group` — GROUP is a SQL keyword.)
CREATE TABLE IF NOT EXISTS species_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 key: species/<group>/<day>-<id>.jpg
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. n-3f9a2c71
  grp         TEXT NOT NULL,          -- plant / bird / insect / mosquito / …  (classifier target)
  species     TEXT,                   -- free-text species name (optional)
  credit_name TEXT,
  region      TEXT,
  lat         REAL,                   -- optional GPS (sighting map)
  lng         REAL,
  acc         INTEGER,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_species_created ON species_samples (created_at);
CREATE INDEX IF NOT EXISTS idx_species_grp ON species_samples (grp);

-- Crowd-sourced citizen infrastructure / environment reports (the /report page).
-- `type` is the classifier target; lat/lng makes a report actionable/mappable.
-- Privacy: the issue photo, not people. See docs/ENVIRONMENT-AI.md.
CREATE TABLE IF NOT EXISTS report_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 key: report/<type>/<day>-<id>.jpg
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. i-3f9a2c71
  type        TEXT NOT NULL,          -- rubbish / flooding / pothole / streetlight / …
  note        TEXT,
  credit_name TEXT,
  region      TEXT,
  lat         REAL,                   -- optional GPS (report map)
  lng         REAL,
  acc         INTEGER,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_created ON report_samples (created_at);
CREATE INDEX IF NOT EXISTS idx_report_type ON report_samples (type);

-- iAny Trace — optional online registry for proof-of-origin capsules (/trace).
-- Offline verification works without this; the registry only adds a TRUSTED
-- first-seen timestamp and double-use transparency (verify_count). `id` is a
-- capsule's content hash (SHA-256). No personal data — just the origin summary.
CREATE TABLE IF NOT EXISTS trace_capsules (
  id            TEXT PRIMARY KEY,      -- capsule content hash (64 hex)
  producer      TEXT,                  -- self-reported origin summary
  product       TEXT,
  created_at    TEXT,                  -- device-claimed capture time (untrusted)
  first_seen    TEXT NOT NULL,         -- server time at first registration (trusted)
  verify_count  INTEGER NOT NULL DEFAULT 0,
  last_verified TEXT,
  published     INTEGER NOT NULL DEFAULT 0, -- has a shareable provenance page
  prev          TEXT,                       -- previous event's capsule id (chain)
  event_type    TEXT,                       -- harvest / process / ship / …
  step          INTEGER                     -- 1-based position in the journey
);
CREATE INDEX IF NOT EXISTS idx_trace_first_seen ON trace_capsules (first_seen);
CREATE INDEX IF NOT EXISTS idx_trace_prev ON trace_capsules (prev);
-- Migration for an existing DB (safe to run once):
--   ALTER TABLE trace_capsules ADD COLUMN published INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE trace_capsules ADD COLUMN prev TEXT;
--   ALTER TABLE trace_capsules ADD COLUMN event_type TEXT;
--   ALTER TABLE trace_capsules ADD COLUMN step INTEGER;

-- Witness confirmations for a capsule (co-op / buyer vouching). Turns a
-- self-claim into a witnessed one; server-timestamped, shown on the page.
CREATE TABLE IF NOT EXISTS trace_attestations (
  id          TEXT NOT NULL,           -- capsule id being vouched for
  name        TEXT NOT NULL,           -- who vouches
  role        TEXT,                    -- e.g. "Kampot Pepper Co-op"
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trace_attest ON trace_attestations (id);
