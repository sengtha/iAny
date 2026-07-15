/**
 * The platform boundary. Core owns the RAG *flow*; each platform plugs in its
 * own storage + model runtimes behind these interfaces:
 *
 *   PWA     -> PGlite + sqlite-vec, transformers.js (ONNX), ort-web, WebAudio
 *   mobile  -> op-sqlite (FTS5 + sqliteVec), llama.rn (GGUF), onnxruntime-rn, expo-av
 *
 * Because the flow lives here, both apps ask, retrieve, and speak identically —
 * only the wiring differs. Add a third target (Pi, desktop) by implementing
 * these, not by rewriting the brain.
 */

import type { ChunkHit, ModelProgress } from './types'
import { buildRagMessages, type RagPromptOptions } from './prompt'

/** On-device vector+text store. */
export interface Storage {
  /** Insert a document, chunk it, embed the chunks, index for hybrid search. */
  addDocument(input: { title: string; content: string; lang: string; packId?: string | null }): Promise<string>
  /** Hybrid (vector + full-text) retrieval. */
  hybridSearch(query: string, topK: number): Promise<ChunkHit[]>
  deleteDocument(id: string): Promise<void>
}

/** Embedding model: text -> unit vectors in the pinned EmbeddingGemma space. */
export interface Embedder {
  init(onProgress?: (p: ModelProgress) => void): Promise<void>
  embed(texts: string[]): Promise<Float32Array[]>
  readonly ready: boolean
}

/** Answering model. Streams tokens to `onToken`; resolves with the full text. */
export interface Generator {
  init(onProgress?: (p: ModelProgress) => void): Promise<void>
  generate(
    messages: { role: 'user' | 'assistant'; content: string }[],
    onToken: (t: string) => void,
    opts?: { maxTokens?: number },
  ): Promise<string>
  readonly ready: boolean
}

/** On-device Khmer TTS. */
export interface Tts {
  init(onProgress?: (p: ModelProgress) => void): Promise<void>
  speak(text: string): Promise<void>
  stop(): Promise<void>
  readonly ready: boolean
}

export interface Engine {
  storage: Storage
  embedder: Embedder
  generator: Generator
  tts?: Tts
}

export interface AskResult {
  answer: string
  sources: ChunkHit[]
}

/**
 * The shared RAG turn: retrieve -> build the (one, shared) prompt -> generate,
 * streaming tokens. Identical on every platform. UIs call this; they don't
 * re-implement retrieval or prompting.
 */
export async function ask(
  engine: Engine,
  question: string,
  onToken: (t: string) => void,
  opts: { topK?: number; maxTokens?: number; prompt?: RagPromptOptions } = {},
): Promise<AskResult> {
  const topK = opts.topK ?? 3
  const sources = await engine.storage.hybridSearch(question, topK)
  const messages = buildRagMessages(question, sources, { topK, ...opts.prompt })
  const answer = await engine.generator.generate(messages, onToken, { maxTokens: opts.maxTokens ?? 256 })
  return { answer, sources }
}
