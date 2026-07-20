-- Grove node (D1). The reference node's storage. Apply once:
--   npx wrangler d1 execute <your-db> --remote --file grove/worker/schema.sql
-- These same two tables are also appended to iAny's worker/schema.sql, so on
-- iany.app they are created by that migration. A standalone node uses this file.
-- See ../SPEC.md (protocol) and ../BRIDGE.md (the CamboVerse read contract).

-- Device-signed garden/tree observations, RE-VERIFIED on ingest (content hash +
-- ECDSA-P256 signature) before a row is written — a node stores only valid
-- records. `id` is the content hash (the observation is content-addressed);
-- `device` is the signer's public key (base64url raw P-256). `raw` is the exact
-- signed JSON, kept verbatim so any consumer can re-verify or federate it. GPS
-- is stored as the author signed it; the public /feed coarsens it on read.
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

-- Third-party co-signatures on an observation (the decentralized trust layer).
-- Also re-verified on ingest. `ref` is the observation being attested; `verdict`
-- is confirm / dispute; `raw` is the exact signed JSON.
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
