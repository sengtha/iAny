/**
 * Core domain types, shared conceptually with the PWA (src/types.ts) so a
 * knowledge pack exported from either side stays compatible. The embedding
 * model and dimensions are pinned app-wide: vectors must be portable across
 * users and across the future marketplace.
 */
export type Language = 'en' | 'km'

/**
 * Native embedding model: EmbeddingGemma-300m (GGUF, run by llama.rn) — the
 * SAME model the PWA uses, so a knowledge pack embedded on desktop stays
 * searchable on mobile (marketplace/sync portability). Gemma-architecture, so
 * llama.rn (built for Gemma) can load it; officially supported by llama.cpp.
 * Multilingual with strong Khmer. Pulled through the iAny mirror (Hugging Face
 * is blocked in some regions). Matryoshka: we truncate the 768-dim output to
 * 256 + renormalize, exactly like the PWA.
 */
export const EMBEDDING_MODEL_REPO = 'ggml-org/embeddinggemma-300M-GGUF'
/** Candidate GGUF filenames, tried in order; if none match, the embedder asks
 *  the HF metadata proxy for the repo's real .gguf and prefers q8_0. */
export const EMBEDDING_MODEL_FILES = [
  'embeddinggemma-300M-Q8_0.gguf',
  'embeddinggemma-300M-q8_0.gguf',
  'embeddinggemma-300m-Q8_0.gguf',
  'embeddinggemma-300M-f16.gguf',
  'embeddinggemma-300M-F16.gguf',
  'embeddinggemma-300M-Q4_K_M.gguf',
]
/** Matryoshka truncation 768 -> 256 + renormalize. Must match the PWA. */
export const EMBEDDING_DIMS = 256
/** iAny model mirror (Cloudflare worker pull-through cache). */
export const MODEL_MIRROR = 'https://iany.sengtha.workers.dev/models'
/** Read-only HF metadata proxy on the same worker (repo file lists), so the
 *  app can discover the exact GGUF filename instead of guessing. */
export const MODEL_API_MIRROR = 'https://iany.sengtha.workers.dev/hf-api'

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
