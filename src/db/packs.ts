import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_SENTENCES,
  EMBEDDING_DIMS,
  type KnowledgePack,
  type PackChunk,
  type PackDocument,
  type PackRow,
} from '../types'
// Canonical model name + integrity live in core so a pack made here imports on
// mobile and vice-versa (both write the SAME embeddingModel string).
import { EMBEDDING_MODEL, PACK_FORMAT, packChecksum, verifyPack } from '@iany/core'
import { b64ToF32, f32ToB64, fromVectorLiteral, toVectorLiteral } from '../lib/base64'
import { getDB } from './client'

/**
 * Knowledge packs are iAny's portability primitive: a self-contained JSON
 * bundle of documents + chunks + embeddings. Because every iAny install
 * pins the same embedding model and dimension, packs import with zero
 * re-embedding — instant to share between devices or (later) to trade on
 * a marketplace. Source text is always included: RAG needs it for
 * generation and it future-proofs packs against embedding model upgrades.
 */

export async function listPacks(): Promise<(PackRow & { document_count: number })[]> {
  const db = await getDB()
  const res = await db.query<PackRow & { document_count: number }>(`
    SELECT p.id, p.name, p.description, p.author, p.origin, p.created_at::text,
           count(d.id)::int AS document_count
    FROM packs p
    LEFT JOIN documents d ON d.pack_id = p.id AND d.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `)
  return res.rows
}

export async function exportPack(meta: {
  name: string
  description?: string
  author?: string
}): Promise<KnowledgePack> {
  const db = await getDB()
  const docs = await db.query<PackDocument>(`
    SELECT id, title, lang, content
    FROM documents WHERE deleted_at IS NULL
    ORDER BY created_at
  `)
  if (docs.rows.length === 0) throw new Error('empty-library')

  const chunks = await db.query<{
    document_id: string
    seq: number
    text: string
    tokens: string
    embedding: string | null
  }>(`
    SELECT c.document_id, c.seq, c.text, c.tokens, c.embedding::text AS embedding
    FROM chunks c
    JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
    ORDER BY c.document_id, c.seq
  `)

  const packChunks: PackChunk[] = chunks.rows
    .filter((c) => c.embedding !== null)
    .map((c) => ({
      document_id: c.document_id,
      seq: c.seq,
      text: c.text,
      tokens: c.tokens,
      embedding: f32ToB64(fromVectorLiteral(c.embedding as string)),
    }))

  const langs = new Set(docs.rows.map((d) => d.lang))
  return {
    manifest: {
      format: PACK_FORMAT,
      id: crypto.randomUUID(),
      name: meta.name,
      description: meta.description ?? '',
      author: meta.author ?? '',
      language: [...langs].join(','),
      // canonical name (not the ONNX repo id) so mobile accepts this pack too
      embeddingModel: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      chunking: { maxChars: CHUNK_MAX_CHARS, overlapSentences: CHUNK_OVERLAP_SENTENCES },
      createdAt: new Date().toISOString(),
      counts: { documents: docs.rows.length, chunks: packChunks.length },
      checksum: packChecksum(docs.rows, packChunks),
    },
    documents: docs.rows,
    chunks: packChunks,
  }
}

/** Validate a pack before import — shared core rules (format, dims, checksum).
 *  Dims mismatch is a hard error here because the PWA vector index is fixed-width
 *  and can't ingest a different size. */
export function validatePack(pack: unknown): KnowledgePack {
  const p = pack as KnowledgePack
  const check = verifyPack(p)
  if (!check.ok) throw new Error(check.errors.join('; '))
  if (p.manifest.dims !== EMBEDDING_DIMS) throw new Error('pack-model-mismatch')
  return p
}

export async function importPack(pack: KnowledgePack): Promise<string> {
  const db = await getDB()
  const packId = crypto.randomUUID()
  // Document ids are remapped so re-importing (or importing a pack built
  // from your own library) never collides with existing rows.
  const idMap = new Map<string, string>(pack.documents.map((d) => [d.id, crypto.randomUUID()]))

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO packs (id, name, description, author, origin) VALUES ($1, $2, $3, $4, 'imported')`,
      [packId, pack.manifest.name, pack.manifest.description, pack.manifest.author],
    )
    for (const doc of pack.documents) {
      await tx.query(
        `INSERT INTO documents (id, title, lang, source_type, pack_id, content)
         VALUES ($1, $2, $3, 'pack', $4, $5)`,
        [idMap.get(doc.id), doc.title, doc.lang, packId, doc.content],
      )
    }
    for (const chunk of pack.chunks) {
      const docId = idMap.get(chunk.document_id)
      if (!docId) continue
      await tx.query(
        `INSERT INTO chunks (id, document_id, seq, text, tokens, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [
          crypto.randomUUID(),
          docId,
          chunk.seq,
          chunk.text,
          chunk.tokens,
          toVectorLiteral(b64ToF32(chunk.embedding)),
        ],
      )
    }
  })
  return packId
}

export async function deletePack(id: string): Promise<void> {
  const db = await getDB()
  await db.transaction(async (tx) => {
    await tx.query(
      `DELETE FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE pack_id = $1)`,
      [id],
    )
    await tx.query(`UPDATE documents SET deleted_at = now(), updated_at = now() WHERE pack_id = $1`, [id])
    await tx.query(`UPDATE packs SET deleted_at = now(), updated_at = now() WHERE id = $1`, [id])
  })
}
