export type Language = 'en' | 'km'

/** Embedding model config is pinned app-wide so vectors stay portable
 *  across users and knowledge packs (the marketplace depends on this). */
export const EMBEDDING_MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX'
/** EmbeddingGemma is a Matryoshka model: we truncate 768 -> 256 dims and
 *  renormalize. 3x smaller storage and faster HNSW with minimal quality loss. */
export const EMBEDDING_DIMS = 256
export const GENERATION_MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX'

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

export interface PackManifest {
  format: 'iany-pack/1'
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

/** 'cached': weights are downloaded (present in the Cache API) but not yet
 *  loaded into memory — loading from disk is fast and happens on demand. */
export type ModelStatus = 'idle' | 'cached' | 'loading' | 'ready' | 'error' | 'unsupported'

export interface ModelProgress {
  target: 'embedder' | 'generator'
  status: ModelStatus
  /** 0..1 overall download progress when loading */
  progress: number
  file?: string
  error?: string
}
