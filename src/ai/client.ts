import { hasModelWeightsCached } from '../lib/modelShare'
import {
  COMPACT_GENERATION_MODEL_ID,
  EMBEDDING_MODEL_ID,
  GENERATION_MODEL_ID,
  type GenModelChoice,
  type ModelProgress,
  type ModelStatus,
} from '../types'
import type { AIRequest, AIResponse } from './protocol'

const GEN_MODEL_KEY = 'iany.genModel'

/** Device-aware default: Gemma 4 E2B needs ~3 GB of tab memory, which
 *  crashes phone browsers, so low-memory/mobile devices default compact. */
export function getGenModelChoice(): GenModelChoice {
  const saved = localStorage.getItem(GEN_MODEL_KEY)
  if (saved === 'full' || saved === 'compact') return saved
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory
  if (deviceMemory !== undefined) return deviceMemory >= 8 ? 'full' : 'compact'
  return navigator.maxTouchPoints > 1 ? 'compact' : 'full'
}

export function getGenModelId(): string {
  return getGenModelChoice() === 'compact' ? COMPACT_GENERATION_MODEL_ID : GENERATION_MODEL_ID
}

/** Persists the choice and reloads so the AI worker starts clean. */
export function setGenModelChoice(choice: GenModelChoice): void {
  localStorage.setItem(GEN_MODEL_KEY, choice)
  location.reload()
}

type Pending = {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  onToken?: (token: string) => void
}

export type ProgressListener = (p: ModelProgress) => void

/** Promise-based RPC over the AI worker, with model progress events. */
class AIClient {
  private worker: Worker | null = null
  private pending = new Map<string, Pending>()
  private listeners = new Set<ProgressListener>()
  readonly status: Record<'embedder' | 'generator', ModelProgress> = {
    embedder: { target: 'embedder', status: 'idle', progress: 0 },
    generator: { target: 'generator', status: 'idle', progress: 0 },
  }

  constructor() {
    void this.refreshCachedStatus()
  }

  /** Reflect what is already downloaded so the UI survives a refresh:
   *  weights in the Cache API => 'cached' instead of 'idle'. */
  async refreshCachedStatus(): Promise<void> {
    const targets = [
      { target: 'embedder', model: EMBEDDING_MODEL_ID },
      { target: 'generator', model: getGenModelId() },
    ] as const
    for (const { target, model } of targets) {
      try {
        if (this.status[target].status === 'idle' && (await hasModelWeightsCached(model))) {
          this.update(target, { status: 'cached', progress: 1 })
        }
      } catch {
        // Cache API unavailable (e.g. private mode) — leave as idle.
      }
    }
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<AIResponse>) => this.handle(e.data)
      // Models are downloaded through this origin's pull-through mirror
      // (see worker/index.ts): client devices frequently cannot reach
      // huggingface.co, while Cloudflare's network can. localStorage
      // 'iany.modelHost' overrides (e.g. 'https://huggingface.co' to go
      // direct during local development).
      const modelHost =
        localStorage.getItem('iany.modelHost') ?? `${location.origin}/models`
      void this.request({
        id: crypto.randomUUID(),
        type: 'configure',
        modelHost,
        generationModel: getGenModelId(),
      })
    }
    return this.worker
  }

  private handle(msg: AIResponse) {
    if (msg.type === 'progress') {
      this.update(msg.target, { status: 'loading', progress: msg.progress, file: msg.file })
      return
    }
    if (msg.type === 'status') {
      this.update(msg.target, {
        status: msg.status,
        progress: msg.status === 'ready' ? 1 : this.status[msg.target].progress,
        error: msg.error,
      })
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    if (msg.type === 'token') {
      p.onToken?.(msg.token)
    } else if (msg.type === 'result') {
      this.pending.delete(msg.id)
      p.resolve(msg.data)
    } else {
      this.pending.delete(msg.id)
      p.reject(new Error(msg.message))
    }
  }

  private update(
    target: 'embedder' | 'generator',
    patch: Partial<Omit<ModelProgress, 'target'>>,
  ) {
    this.status[target] = { ...this.status[target], ...patch, target }
    for (const l of this.listeners) l(this.status[target])
  }

  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private request(req: AIRequest, onToken?: (t: string) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject, onToken })
      this.getWorker().postMessage(req)
    })
  }

  preload(target: 'embedder' | 'generator'): Promise<void> {
    if (this.status[target].status === 'idle' || this.status[target].status === 'cached') {
      this.update(target, { status: 'loading' })
    }
    return this.request({ id: crypto.randomUUID(), type: 'preload', target }).then(() => {})
  }

  async embed(texts: string[], kind: 'query' | 'document'): Promise<Float32Array[]> {
    if (this.status.embedder.status === 'idle' || this.status.embedder.status === 'cached') {
      this.update('embedder', { status: 'loading' })
    }
    return (await this.request({
      id: crypto.randomUUID(),
      type: 'embed',
      texts,
      kind,
    })) as Float32Array[]
  }

  async generate(
    messages: { role: string; content: string }[],
    opts: { maxNewTokens?: number; onToken?: (t: string) => void } = {},
  ): Promise<string> {
    if (this.status.generator.status === 'idle' || this.status.generator.status === 'cached') {
      this.update('generator', { status: 'loading' })
    }
    return (await this.request(
      {
        id: crypto.randomUUID(),
        type: 'generate',
        messages,
        maxNewTokens: opts.maxNewTokens ?? 1024,
      },
      opts.onToken,
    )) as string
  }

  generatorStatus(): ModelStatus {
    return this.status.generator.status
  }
}

export const ai = new AIClient()
