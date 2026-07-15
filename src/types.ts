/**
 * Web (PWA) types. The platform-agnostic domain + pack contract now lives in
 * @iany/core (shared with the mobile app so knowledge packs stay portable);
 * this file re-exports it and adds the WEB-SPECIFIC model registry (ONNX repos
 * for transformers.js). Same brain, web packaging.
 */
export type {
  Language,
  DocumentRow,
  ChunkHit,
  PackRow,
  ChatMessage,
  PackManifest,
  PackDocument,
  PackChunk,
  KnowledgePack,
} from '@iany/core'
export { EMBEDDING_DIMS, CHUNK_MAX_CHARS, CHUNK_OVERLAP_SENTENCES, PACK_FORMAT } from '@iany/core'

/** Web embedding weights: EmbeddingGemma-300m as ONNX (transformers.js). The
 *  logical model + 256-dim space is pinned in core; this is its web packaging. */
export const EMBEDDING_MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX'
export type GenModelChoice = 'tiny' | 'small' | 'compact' | 'full' | 'max' | 'khmer'

export interface GenModelSpec {
  choice: GenModelChoice
  id: string
  /** Short display name (shown in the models list) */
  name: string
  /** Small tiers run on CPU (WASM q8); Gemma 4 needs a working WebGPU. */
  cpuOk: boolean
  /** Below this many cached bytes the download isn't complete. */
  minBytes: number
  /** Qwen3: disable thinking mode per turn (its <think> blocks would
   *  otherwise stream into the chat). */
  noThink?: boolean
  /** Force a single dtype for all devices (e.g. a model exported q8-only). */
  dtype?: string
  /** iAny's fine-tuned Khmer RAG model: use the Khmer training prompt and
   *  skip the extractive fallback (it generates real Khmer answers). */
  khmerRag?: boolean
}

/** Answering model tiers, smallest first (crash recovery steps down this
 *  list). The iAny Khmer model leads — it's the default: purpose-built,
 *  Khmer-first, and runs on any phone. The rest are general Gemma/Qwen ONNX
 *  builds usable by Transformers.js for users who want a bigger model. */
export const GEN_MODELS: GenModelSpec[] = [
  {
    // iAny's own Khmer fine-tune (Gemma 3 270M, continued-pretrained on
    // Khmer then RAG-SFT). q8-only export. THE DEFAULT — small + Khmer-first.
    choice: 'khmer',
    id: 'sengtha/iany-khmer-tiny-v1-ONNX',
    name: 'iAny Khmer 270M',
    cpuOk: true,
    minBytes: 80 * 1e6,
    dtype: 'q8',
    khmerRag: true,
  },
  {
    choice: 'tiny',
    id: 'onnx-community/gemma-3-270m-it-ONNX',
    name: 'Gemma 3 270M',
    cpuOk: true,
    minBytes: 80 * 1e6,
  },
  {
    choice: 'small',
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    name: 'Qwen3 0.6B',
    cpuOk: true,
    minBytes: 250 * 1e6,
    noThink: true,
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

// Domain rows, pack format, and chunk/dims constants now come from @iany/core
// (re-exported at the top of this file) — the single cross-platform source.

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
