import type { ChunkHit } from '../types'
import { toVectorLiteral } from '../lib/base64'
import { getDB } from './client'

const CANDIDATES = 30
const RRF_K = 60

/**
 * Hybrid retrieval: HNSW cosine search and keyword FTS, fused with
 * reciprocal rank fusion. Either leg may come back empty (e.g. FTS finds
 * nothing for a paraphrased query) and the other still carries the result.
 */
export async function hybridSearch(
  queryEmbedding: Float32Array,
  queryTokens: string,
  limit = 6,
): Promise<ChunkHit[]> {
  const db = await getDB()
  const res = await db.query<ChunkHit>(
    `
    WITH vec AS (
      SELECT id, row_number() OVER () AS rank
      FROM (
        SELECT id FROM chunks
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      ) v
    ),
    kw AS (
      SELECT id, row_number() OVER () AS rank
      FROM (
        SELECT id FROM chunks
        WHERE $2 <> '' AND tsv @@ plainto_tsquery('simple', $2)
        ORDER BY ts_rank_cd(tsv, plainto_tsquery('simple', $2)) DESC
        LIMIT $3
      ) k
    )
    SELECT
      c.id AS chunk_id,
      c.document_id,
      d.title,
      c.seq,
      c.text,
      (COALESCE(1.0 / ($5 + vec.rank), 0) + COALESCE(1.0 / ($5 + kw.rank), 0))::float8 AS score
    FROM chunks c
    JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
    LEFT JOIN vec ON vec.id = c.id
    LEFT JOIN kw ON kw.id = c.id
    WHERE vec.id IS NOT NULL OR kw.id IS NOT NULL
    ORDER BY score DESC
    LIMIT $4
    `,
    [toVectorLiteral(queryEmbedding), queryTokens, CANDIDATES, limit, RRF_K],
  )
  return res.rows
}
