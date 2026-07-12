import * as FileSystem from 'expo-file-system'
import { initLlama } from 'llama.rn'
import { GEN_MODEL_FILES, GEN_MODEL_REPO } from '../domain/types'
import { ensureModelFile, errStr } from './modelFile'

/** Inferred to avoid depending on llama.rn's exported type names. */
type LlamaContext = Awaited<ReturnType<typeof initLlama>>

/**
 * On-device text generation via llama.rn (llama.cpp) running a small Gemma 3
 * model (270M on weak phones like the S10; a larger model on capable devices).
 * The answering half of iAny: given retrieved context, it writes a grounded
 * answer in the question's language (Khmer or English). The 270M base model is
 * only for proving the pipeline — real Khmer needs the fine-tuned model
 * (converted to GGUF) or a bigger model on a newer phone.
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
      // Gemma's 262k-token vocabulary makes the generation logits/compute
      // buffer the real memory killer on weak devices — it scales with the
      // physical batch (n_ubatch): 128 x 262144 x 4B ~= 134 MB just for logits,
      // which the S10 can't allocate (embedding never builds this buffer, which
      // is why it loads and generation doesn't). Tiny n_ubatch shrinks it ~16x
      // (~8 MB). Prefill is slower, but it fits. n_ctx 1024 keeps the KV cache
      // small too.
      this.ctx = await initLlama({
        model: path.replace(/^file:\/\//, ''),
        n_ctx: 1024,
        n_batch: 32,
        n_ubatch: 8,
        n_gpu_layers: 0,
      })
    } catch (e) {
      throw new Error(`model load failed (${errStr(e)}) [${sizeMb}MB]`)
    }
    this.status = 'ready'
    onProgress?.({ status: 'ready' })
  }

  /**
   * Generate an answer, streaming tokens to onToken.
   * - Pass a `string` for a fully pre-formatted RAW prompt (used by the Khmer
   *   fine-tune, whose tokenizer has no chat template — we apply the Gemma turn
   *   format manually, matching how it was trained).
   * - Pass `messages` to let llama.rn apply the model's chat template (for
   *   general models that ship one).
   */
  async generate(
    input: string | GenMessage[],
    onToken: (token: string) => void,
    maxTokens = 256,
  ): Promise<string> {
    if (!this.ctx) throw new Error('generator not ready')
    const base = typeof input === 'string' ? { prompt: input } : { messages: input }
    const result = await this.ctx.completion(
      {
        ...base,
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
