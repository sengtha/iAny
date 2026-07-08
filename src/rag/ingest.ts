import { ai } from '../ai/client'
import { chunkText, detectLang } from '../ai/chunker'
import { getDB } from '../db/client'
import { toVectorLiteral } from '../lib/base64'

const EMBED_BATCH = 8

export interface IngestInput {
  title: string
  content: string
  sourceType?: string
}

export interface IngestProgress {
  stage: 'chunking' | 'embedding' | 'saving' | 'done'
  done: number
  total: number
}

/**
 * Feed pipeline: chunk -> embed (batched) -> insert atomically.
 * Embedding runs in the AI worker; this function only coordinates.
 */
export async function ingestDocument(
  input: IngestInput,
  onProgress?: (p: IngestProgress) => void,
): Promise<string> {
  const content = input.content.trim()
  if (!content) throw new Error('empty-content')

  onProgress?.({ stage: 'chunking', done: 0, total: 1 })
  const chunks = chunkText(content)
  if (chunks.length === 0) throw new Error('empty-content')
  const lang = detectLang(content)

  const embeddings: Float32Array[] = []
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH)
    const vecs = await ai.embed(
      batch.map((c) => c.text),
      'document',
    )
    embeddings.push(...vecs)
    onProgress?.({
      stage: 'embedding',
      done: Math.min(i + EMBED_BATCH, chunks.length),
      total: chunks.length,
    })
  }

  onProgress?.({ stage: 'saving', done: chunks.length, total: chunks.length })
  const db = await getDB()
  const docId = crypto.randomUUID()
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO documents (id, title, lang, source_type, content) VALUES ($1, $2, $3, $4, $5)`,
      [docId, input.title.trim() || content.slice(0, 60), lang, input.sourceType ?? 'text', content],
    )
    for (const chunk of chunks) {
      await tx.query(
        `INSERT INTO chunks (id, document_id, seq, text, tokens, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [
          crypto.randomUUID(),
          docId,
          chunk.seq,
          chunk.text,
          chunk.tokens,
          toVectorLiteral(embeddings[chunk.seq]),
        ],
      )
    }
  })
  onProgress?.({ stage: 'done', done: chunks.length, total: chunks.length })
  return docId
}
