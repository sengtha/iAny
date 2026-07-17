import { VoiceRecorder } from '../lib/wavRecorder'

/**
 * PWA Khmer voice input: record from the mic, then transcribe with the
 * whisper-tiny-khmer ONNX model in a worker (see khmerStt.worker.ts). Speak →
 * text → the existing RAG ask() flow. Desktop/tablet only (the UI gates the
 * mic to fine-pointer devices; in-browser Whisper is too slow on a phone).
 */

export type SttPhase = 'idle' | 'recording' | 'loading' | 'transcribing' | 'error'

export interface SttState {
  phase: SttPhase
  /** Live mic level 0–1 while recording. */
  level: number
  /** First-load model download progress 0–1 (transformers.js). */
  download?: number
  error?: string
}

type Listener = (s: SttState) => void

const READY_KEY = 'iany.stt.downloaded'

/** Only offer voice input where in-browser Whisper is practical. */
export function sttSupported(): boolean {
  return (
    VoiceRecorder.isSupported() &&
    typeof matchMedia !== 'undefined' &&
    matchMedia('(pointer: fine)').matches
  )
}

class KhmerStt {
  private worker: Worker | null = null
  private recorder: VoiceRecorder | null = null
  private state: SttState = { phase: 'idle', level: 0 }
  private listeners = new Set<Listener>()
  private seq = 0
  private pending = new Map<string, { resolve: (t: string) => void; reject: (e: Error) => void }>()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  get phase(): SttPhase {
    return this.state.phase
  }

  private set(patch: Partial<SttState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn(this.state)
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./khmerStt.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent) => {
        const m = e.data
        if (m.type === 'progress') {
          const p = m.progress
          if (p && p.status === 'progress' && typeof p.progress === 'number') {
            this.set({ download: Math.min(1, p.progress / 100) })
          }
          return
        }
        if (m.type === 'result') {
          this.pending.get(m.id)?.resolve(m.text)
          this.pending.delete(m.id)
        } else if (m.type === 'error') {
          this.pending.get(m.id)?.reject(new Error(m.error))
          this.pending.delete(m.id)
        }
      }
    }
    return this.worker
  }

  /** Begin recording from the mic. Throws if permission is denied. */
  async startRecording(): Promise<void> {
    if (this.state.phase === 'recording') return
    const rec = new VoiceRecorder({ onLevel: (level) => this.set({ level }) })
    await rec.start()
    this.recorder = rec
    this.set({ phase: 'recording', level: 0, error: undefined })
  }

  /** Stop recording and transcribe. Resolves with the Khmer text (may be empty). */
  async stopAndTranscribe(): Promise<string> {
    const rec = this.recorder
    this.recorder = null
    if (!rec) return ''
    const clip = await rec.stop()
    if (clip.samples.length < 1600) {
      // < 0.1 s of audio — nothing useful to send.
      this.set({ phase: 'idle', level: 0 })
      return ''
    }
    this.set({ phase: this.worker ? 'transcribing' : 'loading', level: 0 })
    const id = String(++this.seq)
    const text = await new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.getWorker().postMessage({ type: 'transcribe', id, audio: clip.samples })
      this.set({ phase: 'transcribing' })
    })
      .catch((e: Error) => {
        this.set({ phase: 'error', error: e.message })
        throw e
      })
    this.set({ phase: 'idle', level: 0, download: undefined })
    return text
  }

  /** Discard an in-progress recording without transcribing. */
  cancel(): void {
    this.recorder?.cancel()
    this.recorder = null
    this.set({ phase: 'idle', level: 0 })
  }

  /** Has the model been fetched into the browser cache on this device? */
  isDownloaded(): boolean {
    try {
      return localStorage.getItem(READY_KEY) === '1'
    } catch {
      return false
    }
  }

  /**
   * Pre-download + warm the model from the Models screen, so voice input is
   * ready instantly (and works offline) before the user ever taps the mic.
   */
  download(onProgress?: (fraction: number) => void): Promise<void> {
    const worker = this.getWorker()
    this.set({ phase: 'loading', download: 0 })
    return new Promise<void>((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const m = e.data
        if (m.type === 'progress') {
          const p = m.progress
          if (p && p.status === 'progress' && typeof p.progress === 'number') {
            const frac = Math.min(1, p.progress / 100)
            this.set({ download: frac })
            onProgress?.(frac)
          }
        } else if (m.type === 'ready') {
          worker.removeEventListener('message', onMsg)
          try {
            localStorage.setItem(READY_KEY, '1')
          } catch {
            /* private mode */
          }
          this.set({ phase: 'idle', download: undefined })
          resolve()
        } else if (m.type === 'error') {
          worker.removeEventListener('message', onMsg)
          this.set({ phase: 'error', error: m.error, download: undefined })
          reject(new Error(m.error))
        }
      }
      worker.addEventListener('message', onMsg)
      worker.postMessage({ type: 'load' })
    })
  }

  /** Remove the cached model (for "redownload"/delete). */
  async clearCache(): Promise<void> {
    try {
      localStorage.removeItem(READY_KEY)
    } catch {
      /* ignore */
    }
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        const c = await caches.open(name)
        for (const req of await c.keys()) {
          if (req.url.includes('whisper-tiny-khmer')) await c.delete(req)
        }
      }
    }
    this.set({ phase: 'idle', level: 0, download: undefined, error: undefined })
  }
}

export const khmerStt = new KhmerStt()
