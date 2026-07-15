import { open, type DB } from '@op-engineering/op-sqlite'
import { randomUUID } from 'expo-crypto'
import {
  EMBEDDING_DIMS,
  base64ToFloat32,
  float32ToBase64,
  type ChunkHit,
  type PackChunk,
  type PackDocument,
} from '@iany/core'
import { chunkText, detectLang } from '../domain/chunk'

/**
 * On-device store, the native equivalent of the PWA's PGlite + pgvector +
 * Postgres-FTS stack (src/db/*). Mapping:
 *   pgvector (HNSW cosine)  -> sqlite-vec vec0 virtual table (KNN)
 *   Postgres FTS (tsvector) -> FTS5 with the trigram tokenizer
 *   RRF fusion in one SQL   -> two queries fused in JS (below)
 *
 * FTS5's trigram tokenizer indexes raw text and matches spaceless Khmer
 * directly, so we do not pre-segment words the way the PWA does. Vectors and
 * FTS live in separate virtual tables, so instead of the PWA's single fused
 * CTE we run each leg and merge with reciprocal rank fusion in TypeScript —
 * same math, clearer across virtual tables.
 *
 * IMPORTANT: op-sqlite's `execute` is asynchronous (returns a Promise), so
 * every call is awaited. Awaiting also works if a version returns a plain
 * value, so this is version-safe. (Stage 1 shipped calling it synchronously,
 * which silently dropped writes and made reads return a Promise — the
 * "Library stays 0" bug.)
 */

const CANDIDATES = 30
const RRF_K = 60

/** Query/document embeddings are injected so the DB layer stays independent
 *  of the inference engine (wired up in Stage 2). */
export interface Embedder {
  embedDocuments(texts: string[]): Promise<Float32Array[]>
  embedQuery(text: string): Promise<Float32Array>
}

let dbPromise: Promise<DB> | null = null
/** True once the sqlite-vec extension is confirmed available (its vec0 table
 *  was created). Stage 1 ships without the extension, so this stays false and
 *  retrieval runs FTS-only; Stage 2 re-enables the op-sqlite sqliteVec build
 *  flag and this flips true automatically — no code change to the callers. */
let vecEnabled = false

export function getDb(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = open({ name: 'iany.db' })
      await migrate(d)
      return d
    })()
    dbPromise.catch(() => {
      // Let the next caller retry a failed open/migrate instead of caching it.
      dbPromise = null
    })
  }
  return dbPromise
}

async function migrate(d: DB): Promise<void> {
  await d.execute('PRAGMA journal_mode = WAL;')
  await d.execute('PRAGMA foreign_keys = ON;')
  await d.execute(`
    CREATE TABLE IF NOT EXISTS packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'imported',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );`)
  await d.execute(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      lang TEXT NOT NULL DEFAULT 'auto',
      source_type TEXT NOT NULL DEFAULT 'text',
      pack_id TEXT REFERENCES packs(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );`)
  await d.execute(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`)
  await d.execute('CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id);')
  // Keyword search. The trigram tokenizer handles Khmer (no word spaces) and
  // English uniformly. External-content-free: we store the text so ranking
  // and snippets work without extra joins.
  await d.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      chunk_id UNINDEXED,
      tokenize = 'trigram'
    );`)
  // Vector search (sqlite-vec). Requires op-sqlite built with the sqliteVec
  // flag (see mobile/package.json + SETUP.md). Absent early — the vec0 module
  // isn't registered, so this throws; we swallow it and run FTS-only.
  //
  // SCHEMA_VERSION bumps whenever the vec table shape changes, so the old
  // fixed-width vec0 table is dropped and rebuilt. v2 tried e5-small (384d);
  // v3 settled on EmbeddingGemma truncated to 256d (matches the PWA). No real
  // vector data has shipped, so the drop is lossless; re-feeding regenerates
  // vectors at the new width.
  const SCHEMA_VERSION = 3
  const verRows = rowsOf(await d.execute('PRAGMA user_version;'))
  const userVersion = Number(verRows[0]?.user_version ?? 0)
  try {
    if (userVersion < SCHEMA_VERSION) {
      await d.execute('DROP TABLE IF EXISTS chunks_vec;')
    }
    await d.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding float[${EMBEDDING_DIMS}]
      );`)
    vecEnabled = true
    await d.execute(`PRAGMA user_version = ${SCHEMA_VERSION};`)
  } catch {
    vecEnabled = false
    console.warn('[iAny] sqlite-vec not available — vector search disabled (FTS only)')
  }
}

/** sqlite-vec accepts a JSON array for a float[] column. */
function vecLiteral(v: Float32Array): string {
  return JSON.stringify(Array.from(v))
}

/** op-sqlite's result shape shifted across versions (`rows` as a plain array
 *  vs `rows._array`). Normalize both to a plain array so a version bump can't
 *  silently break retrieval. */
function rowsOf(res: unknown): Record<string, unknown>[] {
  const r = (res as { rows?: unknown })?.rows
  if (Array.isArray(r)) return r as Record<string, unknown>[]
  const inner = (r as { _array?: unknown })?._array
  return Array.isArray(inner) ? (inner as Record<string, unknown>[]) : []
}

/** Ingest a document: chunk it, index the chunks for FTS, and (when an
 *  embedder is supplied) store their vectors. Mirrors the PWA's
 *  db/documents.ts ingest. */
export async function addDocument(
  input: { title: string; content: string; lang?: string; packId?: string | null },
  embedder?: Embedder,
): Promise<string> {
  const d = await getDb()
  const docId = randomUUID()
  const lang = input.lang ?? detectLang(input.content)
  const chunks = chunkText(input.content)

  const embeddings =
    embedder && vecEnabled ? await embedder.embedDocuments(chunks.map((c) => c.text)) : null

  await d.execute(
    `INSERT INTO documents (id, title, lang, source_type, pack_id, content)
     VALUES (?, ?, ?, 'text', ?, ?);`,
    [docId, input.title, lang, input.packId ?? null, input.content],
  )

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const chunkId = randomUUID()
    await d.execute('INSERT INTO chunks (id, document_id, seq, text) VALUES (?, ?, ?, ?);', [
      chunkId,
      docId,
      c.seq,
      c.text,
    ])
    await d.execute('INSERT INTO chunks_fts (text, chunk_id) VALUES (?, ?);', [c.text, chunkId])
    if (embeddings) {
      await d.execute('INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?);', [
        chunkId,
        vecLiteral(embeddings[i]),
      ])
    }
  }
  return docId
}

/** FTS5 MATCH is a query language, so escape user text as a single quoted
 *  phrase — otherwise punctuation like `?` throws a syntax error. */
function ftsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}

/**
 * Hybrid retrieval: vector KNN + FTS, fused with reciprocal rank fusion.
 * Either leg may be empty (no embedder yet, or FTS finds nothing) and the
 * other still carries the result.
 */
export async function hybridSearch(
  query: string,
  embedder?: Embedder,
  limit = 6,
): Promise<ChunkHit[]> {
  const d = await getDb()
  const ranks = new Map<string, number>() // chunk_id -> fused RRF score

  // Vector leg
  if (embedder && vecEnabled) {
    try {
      const qv = await embedder.embedQuery(query)
      const rows = rowsOf(
        await d.execute(
          `SELECT chunk_id FROM chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?;`,
          [vecLiteral(qv), CANDIDATES],
        ),
      )
      rows.forEach((r, i) => {
        const id = r.chunk_id as string
        ranks.set(id, (ranks.get(id) ?? 0) + 1 / (RRF_K + i + 1))
      })
    } catch (e) {
      // Vector table/extension unavailable — fall back to FTS only.
      console.warn('[iAny] vector search failed:', e)
    }
  }

  // Keyword leg
  const trimmed = query.trim()
  if (trimmed) {
    const rows = rowsOf(
      await d.execute(
        `SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?;`,
        [ftsPhrase(trimmed), CANDIDATES],
      ),
    )
    rows.forEach((r, i) => {
      const id = r.chunk_id as string
      ranks.set(id, (ranks.get(id) ?? 0) + 1 / (RRF_K + i + 1))
    })
  }

  if (ranks.size === 0) return []

  // Resolve the top fused chunk_ids to full hits (with title, joined to the
  // owning document, excluding soft-deleted docs).
  const top = [...ranks.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
  const ids = top.map(([id]) => id)
  const placeholders = ids.map(() => '?').join(',')
  const rows = rowsOf(
    await d.execute(
      `SELECT c.id AS chunk_id, c.document_id, d.title, c.seq, c.text
       FROM chunks c
       JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
       WHERE c.id IN (${placeholders});`,
      ids,
    ),
  )

  const byId = new Map(rows.map((r) => [r.chunk_id as string, r]))
  return top
    .map(([id, score]) => {
      const r = byId.get(id)
      if (!r) return null
      return {
        chunk_id: r.chunk_id as string,
        document_id: r.document_id as string,
        title: r.title as string,
        seq: r.seq as number,
        text: r.text as string,
        score,
      } satisfies ChunkHit
    })
    .filter((x): x is ChunkHit => x !== null)
}

export interface DocSummary {
  id: string
  title: string
  lang: string
  created_at: string
  chunk_count: number
}

export async function listDocuments(): Promise<DocSummary[]> {
  const d = await getDb()
  const rows = rowsOf(
    await d.execute(
      `SELECT d.id, d.title, d.lang, d.created_at,
              (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count
       FROM documents d
       WHERE d.deleted_at IS NULL
       ORDER BY d.created_at DESC;`,
    ),
  )
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    lang: r.lang as string,
    created_at: r.created_at as string,
    chunk_count: Number(r.chunk_count ?? 0),
  }))
}

export async function deleteDocument(id: string): Promise<void> {
  const d = await getDb()
  // Clean the virtual tables first (no cascade into vec0/fts5), then the row.
  const rows = rowsOf(await d.execute('SELECT id FROM chunks WHERE document_id = ?;', [id]))
  for (const r of rows) {
    const chunkId = r.id as string
    await d.execute('DELETE FROM chunks_fts WHERE chunk_id = ?;', [chunkId])
    if (vecEnabled) await d.execute('DELETE FROM chunks_vec WHERE chunk_id = ?;', [chunkId])
  }
  await d.execute('DELETE FROM documents WHERE id = ?;', [id])
}

/* ------------------------------------------------------------------ *
 * Knowledge packs — the portable, cross-platform unit. Export the     *
 * on-device docs+chunks+embeddings as iany-pack/1 (shared with the    *
 * PWA), and import a received one. Embeddings travel as base64 LE      *
 * float32 (core codec), so a pack made on either side searches on the  *
 * other.                                                               *
 * ------------------------------------------------------------------ */

export interface PackData {
  documents: PackDocument[]
  chunks: PackChunk[]
}

/** Read every active document + chunk (+ its embedding) for a pack export. */
export async function exportPackData(): Promise<PackData> {
  const d = await getDb()
  const docRows = rowsOf(
    await d.execute(
      `SELECT id, title, lang, content FROM documents WHERE deleted_at IS NULL ORDER BY created_at;`,
    ),
  )
  const documents: PackDocument[] = docRows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    lang: r.lang as string,
    content: r.content as string,
  }))
  const chunkRows = rowsOf(
    await d.execute(
      `SELECT c.document_id, c.seq, c.text, c.id AS chunk_id
         FROM chunks c JOIN documents dd ON dd.id = c.document_id AND dd.deleted_at IS NULL
        ORDER BY c.document_id, c.seq;`,
    ),
  )
  const chunks: PackChunk[] = []
  for (const r of chunkRows) {
    let embedding = ''
    if (vecEnabled) {
      const vr = rowsOf(
        await d.execute(`SELECT vec_to_json(embedding) AS emb FROM chunks_vec WHERE chunk_id = ?;`, [
          r.chunk_id as string,
        ]),
      )
      const j = vr[0]?.emb
      if (typeof j === 'string') {
        try {
          embedding = float32ToBase64(Float32Array.from(JSON.parse(j) as number[]))
        } catch {
          embedding = ''
        }
      }
    }
    chunks.push({
      document_id: r.document_id as string,
      seq: Number(r.seq),
      text: r.text as string,
      tokens: '',
      embedding,
    })
  }
  return { documents, chunks }
}

/** Insert an imported pack: its metadata row, documents (remapped to fresh ids),
 *  chunks, FTS, and vectors (when dims match the app's embedding space). */
export async function importPackData(
  pack: { id: string; name: string; description: string; author: string },
  documents: PackDocument[],
  chunks: PackChunk[],
): Promise<void> {
  const d = await getDb()
  await d.execute(
    `INSERT OR REPLACE INTO packs (id, name, description, author, origin) VALUES (?, ?, ?, ?, 'imported');`,
    [pack.id, pack.name, pack.description, pack.author],
  )
  const idMap: Record<string, string> = {}
  for (const doc of documents) {
    const newId = randomUUID()
    idMap[doc.id] = newId
    await d.execute(
      `INSERT INTO documents (id, title, lang, source_type, pack_id, content) VALUES (?, ?, ?, 'pack', ?, ?);`,
      [newId, doc.title, doc.lang, pack.id, doc.content],
    )
  }
  for (const ch of chunks) {
    const docId = idMap[ch.document_id]
    if (!docId) continue
    const chunkId = randomUUID()
    await d.execute(`INSERT INTO chunks (id, document_id, seq, text) VALUES (?, ?, ?, ?);`, [
      chunkId,
      docId,
      ch.seq,
      ch.text,
    ])
    await d.execute(`INSERT INTO chunks_fts (text, chunk_id) VALUES (?, ?);`, [ch.text, chunkId])
    if (vecEnabled && ch.embedding) {
      const v = base64ToFloat32(ch.embedding)
      if (v.length === EMBEDDING_DIMS) {
        await d.execute(`INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?);`, [
          chunkId,
          vecLiteral(v),
        ])
      }
    }
  }
}

export interface PackSummary {
  id: string
  name: string
  description: string
  author: string
  doc_count: number
  created_at: string
}

export async function listPacks(): Promise<PackSummary[]> {
  const d = await getDb()
  const rows = rowsOf(
    await d.execute(
      `SELECT p.id, p.name, p.description, p.author, p.created_at,
              (SELECT COUNT(*) FROM documents dd WHERE dd.pack_id = p.id AND dd.deleted_at IS NULL) AS doc_count
         FROM packs p WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC;`,
    ),
  )
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? '',
    author: (r.author as string) ?? '',
    doc_count: Number(r.doc_count ?? 0),
    created_at: r.created_at as string,
  }))
}

export async function deletePack(id: string): Promise<void> {
  const d = await getDb()
  const rows = rowsOf(
    await d.execute(
      `SELECT c.id FROM chunks c JOIN documents dd ON dd.id = c.document_id WHERE dd.pack_id = ?;`,
      [id],
    ),
  )
  for (const r of rows) {
    const chunkId = r.id as string
    await d.execute('DELETE FROM chunks_fts WHERE chunk_id = ?;', [chunkId])
    if (vecEnabled) await d.execute('DELETE FROM chunks_vec WHERE chunk_id = ?;', [chunkId])
  }
  await d.execute('DELETE FROM documents WHERE pack_id = ?;', [id])
  await d.execute('DELETE FROM packs WHERE id = ?;', [id])
}
