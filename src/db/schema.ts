import { EMBEDDING_DIMS } from '../types'

/**
 * Schema notes:
 * - UUIDs, updated_at and soft deletes everywhere: the schema is designed to
 *   be ElectricSQL-syncable later without a migration.
 * - chunks.tokens holds Intl.Segmenter word-segmented text (space-joined).
 *   Khmer is written without spaces between words, so Postgres FTS cannot
 *   tokenize it natively; we pre-segment in JS and index with the 'simple'
 *   config, which works uniformly for Khmer and English.
 * - packs groups content by provenance so imported knowledge packs can be
 *   listed, updated and removed cleanly.
 */
export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS packs (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '',
  origin text NOT NULL DEFAULT 'imported',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  lang text NOT NULL DEFAULT 'auto',
  source_type text NOT NULL DEFAULT 'text',
  pack_id uuid REFERENCES packs(id) ON DELETE SET NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq int NOT NULL,
  text text NOT NULL,
  tokens text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', tokens)) STORED,
  embedding vector(${EMBEDDING_DIMS}),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);
`
