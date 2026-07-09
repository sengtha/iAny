export type Language = 'en' | 'km'

/** Embedding model config is pinned app-wide so vectors stay portable
 *  across users and knowledge packs (the marketplace depends on this). */
export const EMBEDDING_MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX'
/** EmbeddingGemma is a Matryoshka model: we truncate 768 -> 256 dims and
 *  renormalize. 3x smaller storage and faster HNSW with minimal quality loss. */
export const EMBEDDING_DIMS = 256
export type GenModelChoice = 'tiny' | 'compact' | 'full' | 'max'

export interface GenModelSpec {
  choice: GenModelChoice
  id: string
  /** Short display name (shown in the models list) */
  name: string
  /** Gemma 3 tiers run on CPU (WASM q8); Gemma 4 needs a working WebGPU. */
  cpuOk: boolean
  /** Below this many cached bytes the download isn't complete. */
  minBytes: number
}

/** Answering model tiers, smallest first (crash recovery steps down this
 *  list). All are Gemma family so Khmer/multilingual quality holds across
 *  tiers, and all exist as ONNX community builds usable by Transformers.js. */
export const GEN_MODELS: GenModelSpec[] = [
  {
    choice: 'tiny',
    id: 'onnx-community/gemma-3-270m-it-ONNX',
    name: 'Gemma 3 270M',
    cpuOk: true,
    minBytes: 80 * 1e6,
  },
  {
    choice: 'compact',
    id: 'onnx-community/gemma-3-1b-it-ONNX-GQA',
    name: 'Gemma 3 1B',
    cpuOk: true,
    minBytes: 300 * 1e6,
  },
  {
    choice: 'full',
    id: 'onnx-community/gemma-4-E2B-it-ONNX',
    name: 'Gemma 4 E2B',
    cpuOk: false,
    minBytes: 800 * 1e6,
  },
  {
    choice: 'max',
    id: 'onnx-community/gemma-4-E4B-it-ONNX',
    name: 'Gemma 4 E4B',
    cpuOk: false,
    minBytes: 1500 * 1e6,
  },
]

export function genModelSpec(choice: GenModelChoice): GenModelSpec {
  return GEN_MODELS.find((m) => m.choice === choice) ?? GEN_MODELS[0]
}

/** One tier down for crash recovery; null when already at the smallest. */
export function nextSmallerChoice(choice: GenModelChoice): GenModelChoice | null {
  const idx = GEN_MODELS.findIndex((m) => m.choice === choice)
  return idx > 0 ? GEN_MODELS[idx - 1].choice : null
}

export const GENERATION_MODEL_ID = genModelSpec('full').id
export const COMPACT_GENERATION_MODEL_ID = genModelSpec('compact').id
export const TINY_GENERATION_MODEL_ID = genModelSpec('tiny').id

/** A model counts as fully downloaded only above these sizes — config and
 *  tokenizer files alone (or an interrupted weight download) must not show
 *  as 'Downloaded'. Actual sizes: embedder q4 ~200 MB, generator q4f16
 *  ~1.4 GB. */
export const MODEL_MIN_COMPLETE_BYTES: Record<string, number> = {
  [EMBEDDING_MODEL_ID]: 100 * 1e6,
  ...Object.fromEntries(GEN_MODELS.map((m) => [m.id, m.minBytes])),
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
