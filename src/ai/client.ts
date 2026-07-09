import { hasModelWeightsCached } from '../lib/modelShare'
import {
  COMPACT_GENERATION_MODEL_ID,
  EMBEDDING_MODEL_ID,
  GENERATION_MODEL_ID,
  TINY_GENERATION_MODEL_ID,
  type GenModelChoice,
  type ModelProgress,
  type ModelStatus,
} from '../types'
import type { AIRequest, AIResponse } from './protocol'

const GEN_MODEL_KEY = 'iany.genModel'
const CRASH_GUARD_KEY = 'iany.genCrashGuard'

/** Crash detection: the guard is set when a generator load starts and
 *  cleared when it succeeds or fails cleanly. If it is still present on the
 *  next app start, the previous load killed the tab (OOM crash) — warn
 *  instead of walking into the same wall automatically. */
export function getCrashSuspect(): string | null {
  return localStorage.getItem(CRASH_GUARD_KEY)
}

export function clearCrashGuard(): void {
  localStorage.removeItem(CRASH_GUARD_KEY)
}

/** Device-aware default: Gemma 4 E2B needs ~3 GB of tab memory, which
 *  crashes phone browsers, so low-memory/mobile devices default compact. */
export function getGenModelChoice(): GenModelChoice {
  const saved = localStorage.getItem(GEN_MODEL_KEY)
  if (saved === 'full' || saved === 'compact' || saved === 'tiny') return saved
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory
  if (deviceMemory !== undefined) return deviceMemory >= 8 ? 'full' : 'compact'
  return navigator.maxTouchPoints > 1 ? 'compact' : 'full'
}

export function getGenModelId(): string {
  const choice = getGenModelChoice()
  if (choice === 'tiny') return TINY_GENERATION_MODEL_ID
  if (choice === 'compact') return COMPACT_GENERATION_MODEL_ID
  return GENERATION_MODEL_ID
}

/** Persists the choice and reloads so the AI worker starts clean. */
export function setGenModelChoice(choice: GenModelChoice): void {
  localStorage.setItem(GEN_MODEL_KEY, choice)
  clearCrashGuard()
  location.reload()
}

/**
 * Automatic crash recovery, evaluated once per app start BEFORE the AI
 * worker exists: if the previous generator load crashed the tab, step down
 * to the next smaller model so the user isn't asked to diagnose anything.
 * At the tiny tier there is nowhere left to go — chat stays in search mode
 * behind an explicit warning instead.
 */
export const crashRecovery: { downgradedTo: GenModelChoice | null; stuckAtTiny: boolean } =
  (() => {
    try {
      if (getCrashSuspect() !== getGenModelId()) return { downgradedTo: null, stuckAtTiny: false }
      const choice = getGenModelChoice()
      if (choice === 'tiny') return { downgradedTo: null, stuckAtTiny: true }
      const next: GenModelChoice = choice === 'full' ? 'compact' : 'tiny'
      localStorage.setItem(GEN_MODEL_KEY, next)
      clearCrashGuard()
      return { downgradedTo: next, stuckAtTiny: false }
    } catch {
      return { downgradedTo: null, stuckAtTiny: false }
    }
  })()

type Pending = {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  onToken?: (token: string, reset?: boolean) => void
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
      // Arm the crash guard only when the dangerous phase begins: download
      // finished, weights about to be loaded into memory. Arming earlier
      // would misread a tab closed mid-download (normal — downloads are
      // resumable) as a crash.
      if (msg.target === 'generator' && msg.progress >= 0.999) {
        localStorage.setItem(CRASH_GUARD_KEY, getGenModelId())
      }
      this.update(msg.target, {
        status: 'loading',
        progress: msg.progress,
        file: msg.file,
        network: msg.network,
      })
      return
    }
    if (msg.type === 'status') {
      // Any terminal status means the worker survived the load attempt —
      // it wasn't a tab crash.
      if (msg.target === 'generator' && msg.status !== 'loading') clearCrashGuard()
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
      p.onToken?.(msg.token, msg.reset)
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
    // Weights already on disk mean instantiation starts immediately.
    if (target === 'generator' && this.status.generator.status === 'cached') {
      localStorage.setItem(CRASH_GUARD_KEY, getGenModelId())
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
    opts: { maxNewTokens?: number; onToken?: (t: string, reset?: boolean) => void } = {},
  ): Promise<string> {
    if (this.status.generator.status === 'cached') {
      localStorage.setItem(CRASH_GUARD_KEY, getGenModelId())
    }
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
