import { normalizeNumbers, splitForSpeech, type RadioTts } from '@iany/core'

/**
 * The trained iAny Khmer voice (VITS → ONNX) in the browser — the SAME model
 * the mobile app uses, so the PWA reads Khmer news with the real voice instead
 * of the browser's (often missing) km voice.
 *
 * The 114 MB onnx is fetched once through the same-origin model mirror and kept
 * in the Cache API (offline afterwards). Inference runs in a Web Worker so a
 * long news body never freezes the UI; the main thread only tokenizes and plays
 * the returned float PCM through Web Audio.
 */

const TTS_BASE = '/models/sengtha/khmer-tts-female-v2/resolve/main'
// ls100 = length_scale 1.0 (natural/original speed). The filename is the
// cache-bust key; bump it (and VOICE_CACHE) whenever the onnx changes.
const TTS_ONNX = `${TTS_BASE}/khmer_tts_ls100.onnx`
const TTS_META = `${TTS_BASE}/tts_meta.json`
const VOICE_CACHE = 'iany-voice-v2'

interface TtsMeta {
  vocab: string[]
  add_blank: boolean
  sample_rate: number
  blank: string
}

export type VoiceStatus = 'off' | 'downloading' | 'loading' | 'ready' | 'error'
export interface VoiceProgress {
  status: VoiceStatus
  progress?: number
  error?: string
}

class KhmerOnnxTts implements RadioTts {
  private worker: Worker | null = null
  private meta: TtsMeta | null = null
  private idOf: Record<string, number> = {}
  private blankId = 0
  private ctx: AudioContext | null = null
  private sources: AudioBufferSourceNode[] = []
  private speakId = 0
  private synthSeq = 0
  private pending = new Map<
    number,
    { resolve: (pcm: Float32Array) => void; reject: (e: Error) => void }
  >()
  status: VoiceStatus = 'off'

  get ready(): boolean {
    return this.status === 'ready' && this.worker !== null
  }

  /** Is the onnx already cached (so the radio can use it without a download)? */
  async isDownloaded(): Promise<boolean> {
    const c = await this.openCache()
    if (!c) return false
    return (await c.match(TTS_ONNX).catch(() => undefined)) != null
  }

  /** Download (once) + load the ONNX voice into the worker. */
  async init(onProgress?: (p: VoiceProgress) => void): Promise<void> {
    if (this.ready) return
    try {
      this.status = 'downloading'
      onProgress?.({ status: 'downloading', progress: 0 })
      this.meta = (await (await fetch(TTS_META)).json()) as TtsMeta
      this.idOf = {}
      this.meta.vocab.forEach((c, i) => {
        this.idOf[c] = i
      })
      this.blankId = this.idOf[this.meta.blank] ?? 0
      const bytes = await this.loadOnnx((f) => onProgress?.({ status: 'downloading', progress: f }))
      this.status = 'loading'
      onProgress?.({ status: 'loading' })
      await this.startWorker(bytes)
      this.status = 'ready'
      onProgress?.({ status: 'ready' })
    } catch (e) {
      this.status = 'error'
      onProgress?.({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  /** Load the onnx bytes: from the Cache API if available (offline reuse), else
   *  a plain download. The Cache API isn't available in every context (blocked
   *  site-data, some privacy modes) — so it's optional, never required. */
  private async loadOnnx(onProgress: (f: number) => void): Promise<Uint8Array> {
    // Try the cache first (best-effort; ignore any failure).
    const cache = await this.openCache()
    if (cache) {
      const hit = await cache.match(TTS_ONNX).catch(() => undefined)
      if (hit) {
        onProgress(1)
        return new Uint8Array(await hit.arrayBuffer())
      }
    }
    // Download (with progress).
    const net = await fetch(TTS_ONNX)
    if (!net.ok || !net.body) throw new Error(`voice download failed (${net.status})`)
    const total = Number(net.headers.get('content-length') || 0)
    const reader = net.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      if (total) onProgress(received / total)
    }
    const blob = new Blob(chunks as BlobPart[])
    // Cache for next time — best-effort; a failure here must not break loading.
    if (cache) await cache.put(TTS_ONNX, new Response(blob)).catch(() => {})
    return new Uint8Array(await blob.arrayBuffer())
  }

  /** Open the voice cache, or null if the Cache API is unavailable/blocked. */
  private async openCache(): Promise<Cache | null> {
    try {
      if (typeof caches === 'undefined') return null
      return await caches.open(VOICE_CACHE)
    } catch {
      return null
    }
  }

  /** Spin up the inference worker and hand it the model bytes (zero-copy). */
  private startWorker(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./khmertts.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as
          | { type: 'ready' }
          | { type: 'pcm'; id: number; pcm: Float32Array }
          | { type: 'error'; id?: number; error: string }
        if (m.type === 'ready') {
          this.worker = w
          resolve()
        } else if (m.type === 'pcm') {
          this.pending.get(m.id)?.resolve(m.pcm)
          this.pending.delete(m.id)
        } else if (m.type === 'error') {
          if (m.id != null && this.pending.has(m.id)) {
            this.pending.get(m.id)!.reject(new Error(m.error))
            this.pending.delete(m.id)
          } else {
            reject(new Error(m.error))
          }
        }
      }
      w.onerror = (ev) => reject(new Error(ev.message || 'voice worker failed to start'))
      const buf = bytes.buffer as ArrayBuffer
      w.postMessage({ type: 'init', bytes: buf }, [buf])
    })
  }

  /** Khmer text → grapheme token ids, matching the training tokenizer. */
  private textToIds(text: string): number[] {
    const clean = normalizeNumbers(text).toLowerCase().replace(/\s+/g, ' ').trim()
    const ids: number[] = []
    for (const ch of clean) {
      const id = this.idOf[ch]
      if (id !== undefined) ids.push(id)
    }
    if (this.meta?.add_blank) {
      const out: number[] = [this.blankId]
      for (const id of ids) out.push(id, this.blankId)
      return out
    }
    return ids
  }

  /** Ask the worker to synthesize one sentence's ids → float PCM. */
  private synth(ids: number[]): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const id = ++this.synthSeq
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ type: 'synth', id, ids })
    })
  }

  /**
   * Speak the full text. All chunks are sent to the worker up front so it
   * produces PCM continuously (never idles waiting for playback), and each
   * buffer is scheduled back-to-back on the AudioContext clock — gapless while
   * synthesis keeps up, and only a tiny catch-up gap if it briefly can't. This
   * removes the per-chunk "synth then play" stall that caused long waits.
   */
  async speak(text: string): Promise<void> {
    if (!this.worker || !this.meta) throw new Error('voice not ready')
    this.stop()
    const myId = ++this.speakId
    if (!this.ctx) this.ctx = new AudioContext()
    const ctx = this.ctx
    await ctx.resume().catch(() => {})
    const chunks = splitForSpeech(text)
      .map((s) => this.textToIds(s))
      .filter((a) => a.length > 0)
    if (chunks.length === 0) return

    const sr = this.meta.sample_rate
    const pending = chunks.map((ids) => this.synth(ids)) // worker runs them in order
    let nextTime = 0
    let lastEnded: Promise<void> | null = null
    for (let i = 0; i < pending.length; i++) {
      let pcm: Float32Array
      try {
        pcm = await pending[i]
      } catch {
        continue // drop a failed chunk rather than stalling the whole read
      }
      if (myId !== this.speakId) return // superseded by stop()/skip
      const buf = ctx.createBuffer(1, pcm.length, sr)
      buf.getChannelData(0).set(pcm)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      const startAt = Math.max(ctx.currentTime + 0.03, nextTime)
      src.start(startAt)
      nextTime = startAt + buf.duration
      this.sources.push(src)
      lastEnded = new Promise((resolve) => {
        src.onended = () => resolve()
      })
    }
    if (lastEnded) await lastEnded
  }

  stop(): void {
    this.speakId++
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    this.sources = []
  }
}

export const khmerTts = new KhmerOnnxTts()
