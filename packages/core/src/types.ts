/**
 * iAny core domain types — the SINGLE SOURCE OF TRUTH shared by the PWA and the
 * mobile app. Both platforms previously kept their own drifting `types.ts`; this
 * unifies them so a knowledge pack embedded on one runs on the other, and the
 * marketplace stays portable.
 *
 * Nothing in core imports a platform API (no DOM, no React Native, no Node) — it
 * is pure data + logic, bundled by both Vite and Metro.
 */

export type Language = 'en' | 'km'

/**
 * Embedding is pinned app-wide so vectors are portable across users, devices,
 * and packs. The *weights* differ per platform (ONNX for web via transformers.js,
 * GGUF for native via llama.rn) but they are the SAME EmbeddingGemma-300m model
 * and the SAME output space, so a vector made on either side is comparable.
 */
export const EMBEDDING_MODEL = 'EmbeddingGemma-300m'
/** Matryoshka truncation: 768 -> 256 dims + renormalize. Must be identical
 *  everywhere or cosine distances stop being comparable across packs. */
export const EMBEDDING_DIMS = 256

/** Chunking is part of the pack contract — identical on every platform, or two
 *  devices would split the same document differently and packs wouldn't line up. */
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

export interface PackRow {
  id: string
  name: string
  description: string
  author: string
  origin: 'local' | 'imported'
  created_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: ChunkHit[]
}

/* ------------------------------------------------------------------ *
 * Knowledge pack format — the portable, cross-platform exchange unit. *
 * Bump `format` only with a migration; both apps read/write this.     *
 * ------------------------------------------------------------------ */

export const PACK_FORMAT = 'iany-pack/1' as const

export interface PackManifest {
  format: typeof PACK_FORMAT
  id: string
  name: string
  description: string
  author: string
  language: string
  embeddingModel: string
  dims: number
  chunking: { maxChars: number; overlapSentences: number }
  createdAt: string
  counts: { documents: number; chunks: number }
  /** Content checksum (packChecksum) — detects a truncated/corrupted transfer
   *  (e.g. an interrupted Bluetooth send). Optional for backward compatibility. */
  checksum?: string
}

export interface PackDocument {
  id: string
  title: string
  lang: string
  content: string
}

export interface PackChunk {
  document_id: string
  seq: number
  text: string
  tokens: string
  /** base64-encoded little-endian Float32Array, EMBEDDING_DIMS long */
  embedding: string
}

export interface KnowledgePack {
  manifest: PackManifest
  documents: PackDocument[]
  chunks: PackChunk[]
}

/** Model lifecycle, shared vocabulary for both platforms' UIs. */
export type ModelStatus =
  | 'idle'
  | 'downloading'
  | 'cached'
  | 'loading'
  | 'ready'
  | 'error'
  | 'unsupported'

export interface ModelProgress {
  status: ModelStatus
  /** 0..1 while downloading */
  progress?: number
  file?: string
  error?: string
  /** true = pulling over the network, false = loading an already-cached model */
  network?: boolean
}
