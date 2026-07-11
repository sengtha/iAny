import * as FileSystem from 'expo-file-system'
import { initLlama } from 'llama.rn'
import { GEN_MODEL_FILES, GEN_MODEL_REPO } from '../domain/types'
import { ensureModelFile, errStr } from './modelFile'

/** Inferred to avoid depending on llama.rn's exported type names. */
type LlamaContext = Awaited<ReturnType<typeof initLlama>>

/**
 * On-device text generation via llama.rn (llama.cpp) running Gemma 3 1B. The
 * answering half of iAny: given retrieved context, it writes a grounded answer
 * in the question's language (Khmer or English).
 *
 * - Weights are pulled through the iAny mirror once, then reused offline.
 * - CPU-only (n_gpu_layers: 0) — mobile GPU drivers are unreliable.
 * - Streams tokens as they are produced; stops at Gemma's <end_of_turn>.
 */

export type GenStatus = 'off' | 'downloading' | 'loading' | 'ready' | 'error'

export interface GenProgress {
  status: GenStatus
  progress?: number
  error?: string
}

export interface GenMessage {
  role: 'user' | 'assistant'
  content: string
}

class LlamaGenerator {
  private ctx: LlamaContext | null = null
  private initPromise: Promise<void> | null = null
  status: GenStatus = 'off'

  get ready(): boolean {
    return this.status === 'ready' && this.ctx !== null
  }

  async init(onProgress?: (p: GenProgress) => void): Promise<void> {
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

  private async _init(onProgress?: (p: GenProgress) => void): Promise<void> {
    this.status = 'downloading'
    onProgress?.({ status: 'downloading', progress: 0 })
    const path = await ensureModelFile(GEN_MODEL_REPO, GEN_MODEL_FILES, (progress) =>
      onProgress?.({ status: 'downloading', progress }),
    )
    this.status = 'loading'
    onProgress?.({ status: 'loading' })
    const info = await FileSystem.getInfoAsync(path)
    const sizeMb = info.exists && info.size ? (info.size / 1e6).toFixed(0) : '?'
    try {
      // n_ctx 1024 keeps the KV-cache small (weak devices are memory-bound);
      // 4 retrieved chunks + question + answer fit comfortably.
      this.ctx = await initLlama({
        model: path.replace(/^file:\/\//, ''),
        n_ctx: 1024,
        n_gpu_layers: 0,
      })
    } catch (e) {
      throw new Error(`model load failed (${errStr(e)}) [${sizeMb}MB]`)
    }
    this.status = 'ready'
    onProgress?.({ status: 'ready' })
  }

  /**
   * Generate an answer, streaming tokens to onToken. Passing `messages` lets
   * llama.rn apply Gemma's chat template (read from the GGUF).
   */
  async generate(
    messages: GenMessage[],
    onToken: (token: string) => void,
    maxTokens = 256,
  ): Promise<string> {
    if (!this.ctx) throw new Error('generator not ready')
    const result = await this.ctx.completion(
      {
        messages,
        n_predict: maxTokens,
        temperature: 0.3,
        // Small models loop under pure greedy; a light penalty helps.
        penalty_repeat: 1.2,
        stop: ['<end_of_turn>', '<eos>'],
      },
      (data: { token?: string }) => {
        if (data.token) onToken(data.token)
      },
    )
    return (result as { text?: string }).text ?? ''
  }

  async release(): Promise<void> {
    if (this.ctx) {
      await this.ctx.release()
      this.ctx = null
    }
    this.status = 'off'
    this.initPromise = null
  }
}

export const generator = new LlamaGenerator()
