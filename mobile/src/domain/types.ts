/**
 * Core domain types, shared conceptually with the PWA (src/types.ts) so a
 * knowledge pack exported from either side stays compatible. The embedding
 * model and dimensions are pinned app-wide: vectors must be portable across
 * users and across the future marketplace.
 */
export type Language = 'en' | 'km'

/** Pinned so vectors stay portable across devices and knowledge packs. */
export const EMBEDDING_MODEL_ID = 'google/embeddinggemma-300m'
/** Matryoshka truncation 768 -> 256 dims + renormalize: 3x smaller storage,
 *  faster KNN, negligible quality loss. Must match the PWA. */
export const EMBEDDING_DIMS = 256

export const CHUNK_MAX_CHARS = 1200
export const CHUNK_OVERLAP_SENTENCES = 1

export interface DocumentRow {
  id: string
  title: string
  lang: string
  source_type: string
  pack_id: string | null
  content: string
  created_at: string
  updated_at: string
}

export interface ChunkHit {
  chunk_id: string
  document_id: string
  title: string
  seq: number
  text: string
  score: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: ChunkHit[]
}
