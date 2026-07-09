/// <reference lib="webworker" />
/**
 * AI worker: owns both models so the UI thread never blocks.
 * - EmbeddingGemma 300M for embeddings (ingest + query)
 * - Gemma 4 E2B for generation (WebGPU only)
 *
 * Transformers.js caches downloaded weights in the browser Cache API, so
 * models download once per device and then work fully offline.
 */
import {
  env,
  pipeline,
  TextStreamer,
  type FeatureExtractionPipeline,
  type TextGenerationPipeline,
} from '@huggingface/transformers'
import { EMBEDDING_DIMS, EMBEDDING_MODEL_ID, GENERATION_MODEL_ID } from '../types'
import type { AIRequest, AIResponse } from './protocol'

// ONNX Runtime picks a WASM variant at runtime by device capability
// (jsep/jspi for WebGPU, asyncify/plain for CPU). Bundlers only discover one
// variant statically, so all of them are served from /ort/ (see
// scripts/copy-ort.mjs) and cached offline by the service worker.
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/ort/`
}

const post = (msg: AIResponse) => self.postMessage(msg)

async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

function progressForwarder(target: 'embedder' | 'generator') {
  const files = new Map<string, { loaded: number; total: number }>()
  return (p: Record<string, unknown>) => {
    if (p.status === 'progress' && typeof p.file === 'string') {
      files.set(p.file, {
        loaded: (p.loaded as number) ?? 0,
        total: (p.total as number) ?? 0,
      })
      let loaded = 0
      let total = 0
      for (const f of files.values()) {
        loaded += f.loaded
        total += f.total
      }
      post({
        type: 'progress',
        target,
        progress: total > 0 ? loaded / total : 0,
        file: p.file,
      })
    }
  }
}

interface LoadAttempt {
  device: 'webgpu' | 'wasm'
  dtype: string
}

/** Try configurations in order, so one bad device/dtype combination on a
 *  given phone or GPU doesn't take the whole feature down. */
async function loadWithFallback<T>(
  attempts: LoadAttempt[],
  load: (attempt: LoadAttempt) => Promise<T>,
): Promise<T> {
  const failures: string[] = []
  for (const attempt of attempts) {
    try {
      return await load(attempt)
    } catch (e) {
      const detail = `${attempt.device}/${attempt.dtype}: ${e instanceof Error ? e.message : String(e)}`
      console.error('[iAny] model load failed', detail, e)
      failures.push(detail)
    }
  }
  throw new Error(failures.join(' | '))
}

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null
function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const webgpu = await hasWebGPU()
      // EmbeddingGemma activations do not support fp16 — q4/q8/fp32 only.
      const attempts: LoadAttempt[] = [
        ...(webgpu ? [{ device: 'webgpu', dtype: 'q4' } as LoadAttempt] : []),
        { device: 'wasm', dtype: 'q4' },
        { device: 'wasm', dtype: 'q8' },
      ]
      const embedder = await loadWithFallback(attempts, ({ device, dtype }) =>
        pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
          dtype: dtype as 'q4',
          device,
          progress_callback: progressForwarder('embedder'),
        }),
      )
      post({ type: 'status', target: 'embedder', status: 'ready' })
      return embedder
    })()
    embedderPromise.catch((e) => {
      embedderPromise = null
      post({
        type: 'status',
        target: 'embedder',
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      })
    })
  }
  return embedderPromise
}

let generatorPromise: Promise<TextGenerationPipeline> | null = null
function getGenerator(): Promise<TextGenerationPipeline> {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      if (!(await hasWebGPU())) {
        post({ type: 'status', target: 'generator', status: 'unsupported' })
        throw new Error('webgpu-unavailable')
      }
      // q4f16 needs shader-f16 support; q4 covers GPUs without it.
      const generator = await loadWithFallback(
        [
          { device: 'webgpu', dtype: 'q4f16' },
          { device: 'webgpu', dtype: 'q4' },
        ],
        ({ device, dtype }) =>
          pipeline('text-generation', GENERATION_MODEL_ID, {
            dtype: dtype as 'q4f16',
            device,
            progress_callback: progressForwarder('generator'),
          }),
      )
      post({ type: 'status', target: 'generator', status: 'ready' })
      return generator
    })()
    generatorPromise.catch((e) => {
      generatorPromise = null
      const message = e instanceof Error ? e.message : String(e)
      if (message !== 'webgpu-unavailable') {
        post({ type: 'status', target: 'generator', status: 'error', error: message })
      }
    })
  }
  return generatorPromise
}

/** EmbeddingGemma task prompts (required for good retrieval quality). */
function withPrefix(text: string, kind: 'query' | 'document'): string {
  return kind === 'query'
    ? `task: search result | query: ${text}`
    : `title: none | text: ${text}`
}

/** Matryoshka truncation 768 -> EMBEDDING_DIMS, then L2-renormalize. */
function truncateAndNormalize(row: Float32Array): Float32Array {
  const out = row.slice(0, EMBEDDING_DIMS)
  let norm = 0
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}

async function embed(texts: string[], kind: 'query' | 'document'): Promise<Float32Array[]> {
  const embedder = await getEmbedder()
  const prefixed = texts.map((t) => withPrefix(t, kind))
  const output = await embedder(prefixed, { pooling: 'mean', normalize: true })
  const data = output.data as Float32Array
  const dims = output.dims as number[]
  const width = dims[dims.length - 1]
  const rows: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    rows.push(truncateAndNormalize(data.slice(i * width, (i + 1) * width)))
  }
  output.dispose?.()
  return rows
}

async function generate(
  id: string,
  messages: { role: string; content: string }[],
  maxNewTokens: number,
): Promise<string> {
  const generator = await getGenerator()
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (token: string) => post({ id, type: 'token', token }),
  })
  const output = await generator(messages, {
    max_new_tokens: maxNewTokens,
    do_sample: false,
    streamer,
  })
  const last = (
    output as { generated_text: { role: string; content: string }[] }[]
  )[0].generated_text.at(-1)
  return last?.content ?? ''
}

self.onmessage = async (e: MessageEvent<AIRequest>) => {
  const req = e.data
  try {
    switch (req.type) {
      case 'preload': {
        if (req.target === 'embedder') await getEmbedder()
        else await getGenerator()
        post({ id: req.id, type: 'result', data: null })
        break
      }
      case 'embed': {
        const rows = await embed(req.texts, req.kind)
        post({ id: req.id, type: 'result', data: rows })
        break
      }
      case 'generate': {
        const text = await generate(req.id, req.messages, req.maxNewTokens)
        post({ id: req.id, type: 'result', data: text })
        break
      }
    }
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
