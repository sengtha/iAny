import * as FileSystem from 'expo-file-system'
import { initLlama } from 'llama.rn'

/** Inferred rather than imported — avoids depending on llama.rn's exported
 *  type names, which vary across versions. */
type LlamaContext = Awaited<ReturnType<typeof initLlama>>
import {
  EMBEDDING_DIMS,
  EMBEDDING_MODEL_FILES,
  EMBEDDING_MODEL_REPO,
  MODEL_API_MIRROR,
  MODEL_MIRROR,
} from '../domain/types'
import type { Embedder } from '../db/database'

/**
 * On-device text embeddings via llama.rn (llama.cpp) running
 * multilingual-e5-small. This is the native counterpart of the PWA's
 * EmbeddingGemma worker.
 *
 * - The GGUF weights are pulled through the iAny mirror (Hugging Face is
 *   blocked in some regions) into app storage, once, then reused offline.
 * - e5 requires input prefixes: "query: " for searches, "passage: " for
 *   stored documents. Embeddings are L2-normalized so sqlite-vec's default
 *   (L2) KNN ranks them by cosine similarity.
 * - Everything is best-effort: any failure leaves the app on FTS-only search.
 */

export type EmbedderStatus = 'off' | 'downloading' | 'loading' | 'ready' | 'error'

export interface EmbedderProgress {
  status: EmbedderStatus
  /** 0..1 while downloading */
  progress?: number
  error?: string
}

const MODEL_DIR = `${FileSystem.documentDirectory}models/`

function resolveUrl(file: string): string {
  return `${MODEL_MIRROR}/${EMBEDDING_MODEL_REPO}/resolve/main/${file}`
}

/** Native module errors often arrive with an empty message ("Unknown error").
 *  Squeeze out whatever detail exists — message, code, or a stringified body. */
function errStr(e: unknown): string {
  if (e instanceof Error) {
    const anyE = e as { code?: string | number; cause?: unknown }
    const parts = [e.message || e.name]
    if (anyE.code !== undefined) parts.push(`code=${anyE.code}`)
    if (anyE.cause) parts.push(`cause=${String(anyE.cause)}`)
    const s = parts.filter(Boolean).join(' ')
    return s || 'Error with no message'
  }
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

/** L2-normalize so cosine ranking == L2 ranking in sqlite-vec. */
function normalize(v: number[]): Float32Array {
  const out = new Float32Array(v.length)
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

class LlamaEmbedder implements Embedder {
  private ctx: LlamaContext | null = null
  private initPromise: Promise<void> | null = null
  status: EmbedderStatus = 'off'

  get ready(): boolean {
    return this.status === 'ready' && this.ctx !== null
  }

  /** Download (if needed) + load the model. Safe to call repeatedly. */
  async init(onProgress?: (p: EmbedderProgress) => void): Promise<void> {
    if (this.ready) return
    if (!this.initPromise) {
      this.initPromise = this._init(onProgress).catch((e) => {
        this.initPromise = null
        this.status = 'error'
        onProgress?.({ status: 'error', error: errStr(e) })
        throw e
      })
    }
    return this.initPromise
  }

  private async _init(onProgress?: (p: EmbedderProgress) => void): Promise<void> {
    const path = await this.ensureModel(onProgress)
    this.status = 'loading'
    onProgress?.({ status: 'loading' })
    // Include the file and its size in any load failure — a "load failed" on a
    // tiny file means the download got an error page, not a real model.
    const info = await FileSystem.getInfoAsync(path)
    const sizeMb = info.exists && info.size ? (info.size / 1e6).toFixed(1) : '?'
    const name = path.split('/').pop()
    try {
      // CPU-only (n_gpu_layers: 0): mobile GPU drivers are unreliable and the
      // model is small enough to embed on CPU. n_ctx 512 is e5's cap and
      // covers our chunks. Pooling comes from the GGUF metadata.
      this.ctx = await initLlama({
        model: path.replace(/^file:\/\//, ''),
        embedding: true,
        n_ctx: 512,
        n_gpu_layers: 0,
      })
    } catch (e) {
      throw new Error(`model load failed (${errStr(e)}) [file=${name}, ${sizeMb}MB]`)
    }
    this.status = 'ready'
    onProgress?.({ status: 'ready' })
  }

  /** Ensure the GGUF is on disk; returns its local uri. Probes candidate
   *  filenames on the mirror, downloads the first that exists. */
  private async ensureModel(onProgress?: (p: EmbedderProgress) => void): Promise<string> {
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true }).catch(() => {})

    // Already downloaded? Any cached candidate file will do.
    for (const file of EMBEDDING_MODEL_FILES) {
      const dest = MODEL_DIR + file
      const info = await FileSystem.getInfoAsync(dest)
      if (info.exists && info.size && info.size > 1_000_000) return dest
    }

    // Find which candidate the mirror actually has (fast path), else ask the
    // HF metadata proxy for the repo's real GGUF filename (robust path).
    let chosen: string | null = null
    for (const file of EMBEDDING_MODEL_FILES) {
      try {
        const head = await fetch(resolveUrl(file), { method: 'HEAD' })
        if (head.ok) {
          chosen = file
          break
        }
      } catch {
        // network hiccup — try the next candidate
      }
    }
    if (!chosen) chosen = await this.discoverFile()
    if (!chosen) {
      throw new Error('embedding model not found on mirror (no .gguf in repo?)')
    }

    this.status = 'downloading'
    onProgress?.({ status: 'downloading', progress: 0 })
    const dest = MODEL_DIR + chosen
    const tmp = `${dest}.part`
    const resumable = FileSystem.createDownloadResumable(
      resolveUrl(chosen),
      tmp,
      {},
      (p) => {
        const total = p.totalBytesExpectedToWrite
        if (total > 0) {
          onProgress?.({ status: 'downloading', progress: p.totalBytesWritten / total })
        }
      },
    )
    const res = await resumable.downloadAsync()
    if (!res || (res.status && res.status >= 400)) {
      await FileSystem.deleteAsync(tmp, { idempotent: true })
      throw new Error(`model download failed (status ${res?.status ?? 'unknown'})`)
    }
    await FileSystem.moveAsync({ from: tmp, to: dest })
    return dest
  }

  /** Ask the HF metadata proxy for the repo's actual GGUF files and pick one
   *  (prefer q8_0, then f16, then anything). Returns null if unreachable. */
  private async discoverFile(): Promise<string | null> {
    try {
      const res = await fetch(`${MODEL_API_MIRROR}/models/${EMBEDDING_MODEL_REPO}`)
      if (!res.ok) return null
      const data = (await res.json()) as { siblings?: { rfilename: string }[] }
      const files = (data.siblings ?? [])
        .map((s) => s.rfilename)
        .filter((f) => f.toLowerCase().endsWith('.gguf'))
      return (
        files.find((f) => /q8_0/i.test(f)) ??
        files.find((f) => /f16/i.test(f)) ??
        files.find((f) => /q4_k/i.test(f)) ??
        files[0] ??
        null
      )
    } catch {
      return null
    }
  }

  private async embedOne(text: string): Promise<Float32Array> {
    if (!this.ctx) throw new Error('embedder not ready')
    const { embedding } = await this.ctx.embedding(text)
    if (!embedding || embedding.length !== EMBEDDING_DIMS) {
      throw new Error(
        `unexpected embedding size ${embedding?.length ?? 0} (expected ${EMBEDDING_DIMS})`,
      )
    }
    return normalize(embedding)
  }

  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = []
    for (const t of texts) out.push(await this.embedOne(`passage: ${t}`))
    return out
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return this.embedOne(`query: ${text}`)
  }

  /** Free native memory (e.g. before loading the generator in Stage 3). */
  async release(): Promise<void> {
    if (this.ctx) {
      await this.ctx.release()
      this.ctx = null
    }
    this.status = 'off'
    this.initPromise = null
  }
}

/** App-wide singleton. */
export const embedder = new LlamaEmbedder()
