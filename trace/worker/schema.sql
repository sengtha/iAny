-- Trace — optional online registry (Cloudflare D1). Apply once:
--   npx wrangler d1 execute <your-db> --remote --file trace/worker/schema.sql
--
-- Offline Create + Verify work with NO backend. This schema is only needed for
-- the online add-ons: a trusted first-seen timestamp, double-use transparency,
-- the shareable provenance page, witness attestations, and the journey chain.
-- See ../GUIDE.md and ../SPEC.md.

-- A capsule's id is its own content hash (SHA-256, 64 hex). The registry stores
-- only the origin summary + timestamps — no images, no personal data.
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

-- Companion custody layer — supply-chain actors (delivery, warehouse, exporter)
-- join the proof with device-SIGNED events. Verified on ingest (ECDSA-P256).
-- See ../core/companion.ts. `company_key` is filled only when a valid, bound
-- delegation was present (else the event is "self-claimed").
CREATE TABLE IF NOT EXISTS trace_custody (
  id          TEXT PRIMARY KEY,      -- SHA-256 of the signed record (dedupe key)
  capsule     TEXT NOT NULL,         -- product capsule id this event is about
  actor_key   TEXT NOT NULL,         -- signer (staff) public key (base64url P-256)
  actor_name  TEXT,                  -- self-declared signer name
  role        TEXT NOT NULL,         -- carrier / warehouse / exporter / …
  event_type  TEXT NOT NULL,         -- pickup / in_transit / store / handoff / …
  company_key TEXT,                  -- company root key (from a valid delegation)
  lat         REAL,                  -- as-signed GPS (coarsened on the public feed)
  lng         REAL,
  claimed_at  TEXT,                  -- signer-claimed time (untrusted)
  note        TEXT,
  raw         TEXT NOT NULL,         -- exact signed JSON (re-verifiable / federatable)
  created_at  TEXT NOT NULL          -- server first-seen (trusted)
);
CREATE INDEX IF NOT EXISTS idx_trace_custody_capsule ON trace_custody (capsule);
CREATE INDEX IF NOT EXISTS idx_trace_custody_company ON trace_custody (company_key);

-- Partner registry — resolves a company ROOT key → public name / logo. Rows are
-- self-asserted (signed by the root key, so only its owner can claim a name);
-- `verified` is flipped to 1 by an operator after vetting (the "verify names
-- later" half of the hybrid). Staff resolve to a company via their delegation.
CREATE TABLE IF NOT EXISTS trace_partners (
  company_key TEXT PRIMARY KEY,      -- company root public key (base64url P-256)
  name        TEXT NOT NULL,
  logo        TEXT,                  -- data: URI or URL (small)
  region      TEXT,
  verified    INTEGER NOT NULL DEFAULT 0,
  raw         TEXT NOT NULL,         -- the signed registration (re-verifiable)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Two-party handoff transport (Phase 2). A sender publishes a signed RELEASE
-- under a short code; the receiver reads it and counter-signs a RECEIPT. On
-- completion the node writes two trace_custody rows (release=handoff,
-- receipt=pickup) and deletes the pending row. Short-lived (TTL), single-use.
CREATE TABLE IF NOT EXISTS trace_handoff_pending (
  code         TEXT PRIMARY KEY,     -- short human code (e.g. K7M4P2)
  capsule      TEXT NOT NULL,
  from_key     TEXT NOT NULL,        -- sender public key
  nonce        TEXT NOT NULL,        -- binds the receipt to this release
  raw_release  TEXT NOT NULL,        -- the signed release (re-verifiable)
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | received
  to_name      TEXT,                 -- receiver's name (proof of delivery)
  completed_at TEXT,                 -- when the receipt was signed
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trace_handoff_expires ON trace_handoff_pending (expires_at);
-- Migration for a DB that already created this table (safe to run once):
--   ALTER TABLE trace_handoff_pending ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
--   ALTER TABLE trace_handoff_pending ADD COLUMN to_name TEXT;
--   ALTER TABLE trace_handoff_pending ADD COLUMN completed_at TEXT;

-- Revocations (Phase 3): a company root revokes one of its staff keys before the
-- delegation's natural expiry. On ingest the node refuses to attribute that
-- staff's events to the company (they drop to self-claimed). Signed by the root.
CREATE TABLE IF NOT EXISTS trace_revocations (
  company_key TEXT NOT NULL,         -- company root key doing the revoking
  staff_key   TEXT NOT NULL,         -- the staff key being revoked
  at          TEXT NOT NULL,         -- signer-claimed revoke time
  raw         TEXT NOT NULL,         -- the signed revocation (re-verifiable)
  created_at  TEXT NOT NULL,
  PRIMARY KEY (company_key, staff_key)
);
