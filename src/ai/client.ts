import { hasModelWeightsCached } from '../lib/modelShare'
import {
  EMBEDDING_MODEL_ID,
  GEN_MODELS,
  genModelSpec,
  nextSmallerChoice,
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

/** The engine generation last ran on ('wasm' = CPU), if known. */
export function getLastGenDevice(): 'webgpu' | 'wasm' | null {
  const v = localStorage.getItem('iany.genDevice')
  return v === 'webgpu' || v === 'wasm' ? v : null
}

/** Device-aware default: Gemma 4 E2B needs ~3 GB of tab memory, which
 *  crashes phone browsers, so low-memory/mobile devices default compact. */
export function getGenModelChoice(): GenModelChoice {
  const saved = localStorage.getItem(GEN_MODEL_KEY)
  if (saved && GEN_MODELS.some((m) => m.choice === saved)) return saved as GenModelChoice
  // Default to the small iAny Khmer model: purpose-built, Khmer-first, and runs
  // on any phone ("start small"). Users can pick a bigger general model below.
  return 'khmer'
}

export function getGenModelId(): string {
  return genModelSpec(getGenModelChoice()).id
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
      const next = nextSmallerChoice(getGenModelChoice())
      if (!next) return { downgradedTo: null, stuckAtTiny: true }
      localStorage.setItem(GEN_MODEL_KEY, next)
      clearCrashGuard()
      return { downgradedTo: next, stuckAtTiny: false }
    } catch {
      return { downgradedTo: null, stuckAtTiny: false }
    }
  })()

type Role = 'embedder' | 'generator'

type Pending = {
  role: Role
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  onToken?: (token: string, reset?: boolean) => void
}

/** On weak devices both models don't fit in memory together (embedder
 *  ~0.5 GB + generator ~0.8 GB exceeds a mobile tab's budget), so each
 *  lives in its own worker and only one stays resident at a time. 'tiny'
 *  is itself a signal of a weak device (auto-downgrade lands there). */
function isLowMemoryDevice(): boolean {
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory
  return (
    (deviceMemory !== undefined && deviceMemory <= 4) ||
    getGenModelChoice() === 'tiny' ||
    // CPU generation means the whole model lives in tab memory — never
    // keep both models resident there regardless of tier.
    getLastGenDevice() === 'wasm'
  )
}

export type ProgressListener = (p: ModelProgress) => void

/** Promise-based RPC over the AI workers, with model progress events.
 *  The embedder and generator run in separate workers so either can be
 *  released (terminated) independently to reclaim memory. */
class AIClient {
  private workers: Record<Role, Worker | null> = { embedder: null, generator: null }
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

  private getWorker(role: Role): Worker {
    if (!this.workers[role]) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<AIResponse>) => this.handle(e.data)
      this.workers[role] = worker
      // Models are downloaded through this origin's pull-through mirror
      // (see worker/index.ts): client devices frequently cannot reach
      // huggingface.co, while Cloudflare's network can. localStorage
      // 'iany.modelHost' overrides (e.g. 'https://huggingface.co' to go
      // direct during local development).
      const modelHost =
        localStorage.getItem('iany.modelHost') ?? `${location.origin}/models`
      // Coarse pointer = phone/tablet: their WebGPU is unreliable for LLM
      // inference (the Galaxy S10 crashes the tab), so prefer CPU there.
      const preferCpu =
        typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
      void this.request(
        {
          id: crypto.randomUUID(),
          type: 'configure',
          modelHost,
          generationModel: getGenModelId(),
          preferCpu,
        },
        role,
      )
    }
    return this.workers[role]!
  }

  /** Terminate a worker to reclaim its memory. The model stays on disk
   *  ('cached') and reloads on next use. */
  private release(role: Role): void {
    const worker = this.workers[role]
    if (!worker) return
    worker.terminate()
    this.workers[role] = null
    for (const [id, p] of [...this.pending]) {
      if (p.role === role) {
        this.pending.delete(id)
        p.reject(new Error('released'))
      }
    }
    // An intentional terminate during load must not read as a tab crash.
    if (role === 'generator') clearCrashGuard()
    if (this.status[role].status === 'ready' || this.status[role].status === 'loading') {
      this.update(role, { status: 'cached', progress: 1 })
    }
  }

  /** Before heavy work in one worker, free the other on weak devices. */
  private makeRoomFor(role: Role): void {
    if (!isLowMemoryDevice()) return
    this.release(role === 'embedder' ? 'generator' : 'embedder')
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
      // Remember which engine generation actually runs on: CPU (wasm)
      // devices need tight prompt caps (see rag/ask.ts).
      if (msg.target === 'generator' && msg.status === 'ready' && msg.device) {
        localStorage.setItem('iany.genDevice', msg.device)
      }
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

  private request(
    req: AIRequest,
    role: Role,
    onToken?: (t: string, reset?: boolean) => void,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { role, resolve, reject, onToken })
      this.getWorker(role).postMessage(req)
    })
  }

  preload(target: Role): Promise<void> {
    this.makeRoomFor(target)
    if (this.status[target].status === 'idle' || this.status[target].status === 'cached') {
      this.update(target, { status: 'loading' })
    }
    // Weights already on disk mean instantiation starts immediately.
    if (target === 'generator' && this.status.generator.status === 'cached') {
      localStorage.setItem(CRASH_GUARD_KEY, getGenModelId())
    }
    return this.request({ id: crypto.randomUUID(), type: 'preload', target }, target).then(
      () => {},
    )
  }

  async embed(texts: string[], kind: 'query' | 'document'): Promise<Float32Array[]> {
    this.makeRoomFor('embedder')
    if (this.status.embedder.status === 'idle' || this.status.embedder.status === 'cached') {
      this.update('embedder', { status: 'loading' })
    }
    return (await this.request(
      { id: crypto.randomUUID(), type: 'embed', texts, kind },
      'embedder',
    )) as Float32Array[]
  }

  async generate(
    messages: { role: string; content: string }[],
    opts: {
      maxNewTokens?: number
      onToken?: (t: string, reset?: boolean) => void
      raw?: boolean
    } = {},
  ): Promise<string> {
    this.makeRoomFor('generator')
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
        raw: opts.raw,
      },
      'generator',
      opts.onToken,
    )) as string
  }

  generatorStatus(): ModelStatus {
    return this.status.generator.status
  }
}

export const ai = new AIClient()
