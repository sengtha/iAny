/**
 * Core domain types, shared conceptually with the PWA (src/types.ts) so a
 * knowledge pack exported from either side stays compatible. The embedding
 * model and dimensions are pinned app-wide: vectors must be portable across
 * users and across the future marketplace.
 */
export type Language = 'en' | 'km'

/**
 * Native embedding model: multilingual-e5-small (GGUF, run by llama.rn).
 * Small (~130 MB q8) and fast on weak phones, covers Khmer + English. e5 is
 * NOT a Matryoshka model, so we keep its full 384 dims (no truncation). The
 * model is pulled through the iAny mirror because Hugging Face is unreachable
 * from some regions (Cambodia). Upgradeable later (e.g. bge-m3 / EmbeddingGemma
 * for stronger Khmer) by changing these constants + re-indexing.
 */
export const EMBEDDING_MODEL_REPO = 'cstr/multilingual-e5-small-GGUF'
/** Candidate GGUF filenames, tried in order (uploaders name quants
 *  inconsistently). The first that exists on the mirror is downloaded. */
export const EMBEDDING_MODEL_FILES = [
  'multilingual-e5-small.Q8_0.gguf',
  'multilingual-e5-small-Q8_0.gguf',
  'multilingual-e5-small.q8_0.gguf',
  'multilingual-e5-small.F16.gguf',
  'multilingual-e5-small.f16.gguf',
  'multilingual-e5-small-f16.gguf',
]
export const EMBEDDING_DIMS = 384
/** iAny model mirror (Cloudflare worker pull-through cache). */
export const MODEL_MIRROR = 'https://iany.sengtha.workers.dev/models'

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
