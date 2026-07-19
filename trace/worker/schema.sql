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
