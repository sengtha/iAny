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
  kit         TEXT,                   -- kit / brand (different kits = different colour charts)
  reading     TEXT,                   -- value read off the kit's chart, e.g. "10 ppb" / "pH 6.5"
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
-- Migration for an existing DB (safe once): ALTER TABLE water_samples ADD COLUMN kit TEXT;
--   ALTER TABLE water_samples ADD COLUMN reading TEXT;

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

-- Crowd-sourced Cambodia street-vehicle photos (the /street page). Each row is
-- one (image, vehicle type) sample for training an offline vehicle classifier
-- with the classes COCO detectors lack (tuk-tuk / remork / cyclo) — so the
-- /traffic counter can count tuk-tuks correctly. See docs/SMARTCITY-AI.md.
-- Image in R2 at r2_key (foldered street/<type>/); device is anonymous.
CREATE TABLE IF NOT EXISTS street_samples (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,          -- R2 key: street/<type>/<day>-<id>.jpg
  device      TEXT NOT NULL,          -- anonymous per-device id, e.g. t-3f9a2c71
  type        TEXT NOT NULL,          -- tuktuk / remork / cyclo / motorbike / …  (classifier target)
  note        TEXT,
  credit_name TEXT,                   -- opt-in public credit (dataset contributors)
  region      TEXT,
  lat         REAL,                   -- optional GPS (where the photo was taken)
  lng         REAL,
  acc         INTEGER,                -- GPS accuracy radius (metres)
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_street_created ON street_samples (created_at);
CREATE INDEX IF NOT EXISTS idx_street_type ON street_samples (type);

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

-- Grove — the open, decentralized garden-carbon network (/garden). The user's
-- phone signs each observation on-device (the source of truth); iany.app runs a
-- reference NODE that re-verifies every signature before storing and serves
-- public read-only feeds anyone can consume (dashboards, communities, CamboVerse).
-- Canonical schema + docs live in grove/worker/schema.sql, grove/SPEC.md and
-- grove/BRIDGE.md; these two tables are duplicated here so iAny's D1 migration
-- creates them. `id` is the content hash; `device` is the signer's public key;
-- `raw` is the exact signed JSON (re-verifiable / federatable).
CREATE TABLE IF NOT EXISTS grove_observations (
  id          TEXT PRIMARY KEY,       -- SHA-256 of the canonical observation (64 hex)
  device      TEXT NOT NULL,          -- signer public key (base64url raw P-256)
  plot        TEXT NOT NULL,          -- stable plot id grouping a garden over time
  species     TEXT NOT NULL,          -- species id/name, e.g. "mango"
  count       INTEGER NOT NULL,       -- identical plants this record represents
  co2_kg      REAL NOT NULL,          -- estimated CO2e (total = per-plant × count)
  biomass_kg  REAL NOT NULL,          -- estimated above-ground biomass (total)
  lat         REAL,                   -- optional GPS claim (as signed)
  lng         REAL,
  acc         INTEGER,                -- GPS accuracy radius (metres)
  observed_at TEXT NOT NULL,          -- device-claimed observation time (untrusted)
  photo_hash  TEXT NOT NULL,          -- SHA-256 of the photo (provenance anchor)
  prev        TEXT,                   -- previous observation id for this plot (chain)
  raw         TEXT NOT NULL,          -- exact signed JSON (re-verifiable / federatable)
  created_at  TEXT NOT NULL           -- server first-seen (trusted)
);
CREATE INDEX IF NOT EXISTS idx_grove_obs_created ON grove_observations (created_at);
CREATE INDEX IF NOT EXISTS idx_grove_obs_plot ON grove_observations (plot);
CREATE INDEX IF NOT EXISTS idx_grove_obs_device ON grove_observations (device);

CREATE TABLE IF NOT EXISTS grove_attestations (
  id          TEXT PRIMARY KEY,       -- SHA-256 of the canonical attestation (64 hex)
  ref         TEXT NOT NULL,          -- observation id being attested
  device      TEXT NOT NULL,          -- attester public key (base64url raw P-256)
  verdict     TEXT NOT NULL,          -- confirm / dispute
  note        TEXT,
  at          TEXT NOT NULL,          -- attester-claimed time (untrusted)
  raw         TEXT NOT NULL,          -- exact signed JSON (re-verifiable)
  created_at  TEXT NOT NULL           -- server first-seen (trusted)
);
CREATE INDEX IF NOT EXISTS idx_grove_att_ref ON grove_attestations (ref);
CREATE INDEX IF NOT EXISTS idx_grove_att_device ON grove_attestations (device);
