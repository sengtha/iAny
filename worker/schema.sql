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
  sponsor     TEXT,
  lang        TEXT NOT NULL DEFAULT 'km',
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL           -- created_at + 7 days; cron purges past this
);
CREATE INDEX IF NOT EXISTS idx_news_created ON news (created_at);
CREATE INDEX IF NOT EXISTS idx_news_expires ON news (expires_at);
