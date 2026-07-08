import type { DocumentRow } from '../types'
import { getDB } from './client'

export interface DocumentSummary {
  id: string
  title: string
  lang: string
  pack_id: string | null
  created_at: string
  chunk_count: number
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const db = await getDB()
  const res = await db.query<DocumentSummary>(`
    SELECT d.id, d.title, d.lang, d.pack_id, d.created_at::text,
           count(c.id)::int AS chunk_count
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    WHERE d.deleted_at IS NULL
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `)
  return res.rows
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  const db = await getDB()
  const res = await db.query<DocumentRow>(
    `SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )
  return res.rows[0] ?? null
}

/** Soft delete keeps the schema sync-friendly; chunks are removed so they
 *  drop out of retrieval immediately and free vector index space. */
export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB()
  await db.transaction(async (tx) => {
    await tx.query(`DELETE FROM chunks WHERE document_id = $1`, [id])
    await tx.query(`UPDATE documents SET deleted_at = now(), updated_at = now() WHERE id = $1`, [
      id,
    ])
  })
}

export interface DbStats {
  documents: number
  chunks: number
}

export async function getStats(): Promise<DbStats> {
  const db = await getDB()
  const res = await db.query<DbStats>(`
    SELECT
      (SELECT count(*)::int FROM documents WHERE deleted_at IS NULL) AS documents,
      (SELECT count(*)::int FROM chunks) AS chunks
  `)
  return res.rows[0]
}

export async function wipeDatabase(): Promise<void> {
  const db = await getDB()
  await db.exec(`
    DELETE FROM chunks;
    DELETE FROM documents;
    DELETE FROM packs;
  `)
}
