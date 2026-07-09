export type Language = 'en' | 'km'

/** Embedding model config is pinned app-wide so vectors stay portable
 *  across users and knowledge packs (the marketplace depends on this). */
export const EMBEDDING_MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX'
/** EmbeddingGemma is a Matryoshka model: we truncate 768 -> 256 dims and
 *  renormalize. 3x smaller storage and faster HNSW with minimal quality loss. */
export const EMBEDDING_DIMS = 256
export const GENERATION_MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX'
/** Compact answering model for memory-constrained devices (phones): loading
 *  Gemma 4 E2B needs ~3 GB of tab memory, which crashes most mobile
 *  browsers. Gemma 3 1B (GQA build, optimized for WebGPU) is ~700 MB and
 *  still strongly multilingual. */
export const COMPACT_GENERATION_MODEL_ID = 'onnx-community/gemma-3-1b-it-ONNX-GQA'
/** Last-resort tier (~0.25 GB): for phones where even the 1B model crashes
 *  the tab at load time. Noticeably weaker answers, but it runs. */
export const TINY_GENERATION_MODEL_ID = 'onnx-community/gemma-3-270m-it-ONNX'
export type GenModelChoice = 'full' | 'compact' | 'tiny'

/** A model counts as fully downloaded only above these sizes — config and
 *  tokenizer files alone (or an interrupted weight download) must not show
 *  as 'Downloaded'. Actual sizes: embedder q4 ~200 MB, generator q4f16
 *  ~1.4 GB. */
export const MODEL_MIN_COMPLETE_BYTES: Record<string, number> = {
  [EMBEDDING_MODEL_ID]: 100 * 1e6,
  [GENERATION_MODEL_ID]: 800 * 1e6,
  [COMPACT_GENERATION_MODEL_ID]: 300 * 1e6,
  [TINY_GENERATION_MODEL_ID]: 80 * 1e6,
}

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
  /** while loading: true = downloading over the network, false = reading
   *  an already-downloaded model from storage */
  network?: boolean
}
