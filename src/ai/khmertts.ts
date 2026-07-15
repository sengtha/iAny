import type * as Ort from 'onnxruntime-web'
import { normalizeNumbers, splitSentences, type RadioTts } from '@iany/core'

// Lazy-loaded so onnxruntime-web (~400 KB) only enters the bundle when the user
// actually downloads / uses the voice — not on every page load.
let ort: typeof import('onnxruntime-web') | null = null
async function loadOrt(): Promise<typeof import('onnxruntime-web')> {
  if (!ort) ort = await import('onnxruntime-web')
  return ort
}

/**
 * The trained iAny Khmer voice (VITS → ONNX) running in the browser via
 * onnxruntime-web — the SAME model the mobile app uses, so the PWA reads Khmer
 * news with the real voice instead of the browser's (often missing) km voice.
 *
 * The 114 MB onnx is fetched once through the same-origin model mirror and kept
 * in the Cache API, so it works offline afterwards. Tokenization mirrors the
 * coqui training tokenizer (grapheme → id from tts_meta.json, add_blank
 * interleave); output float PCM is played through Web Audio.
 */

const TTS_BASE = '/models/sengtha/khmer-tts-female-v2/resolve/main'
const TTS_ONNX = `${TTS_BASE}/khmer_tts_ls115.onnx`
const TTS_META = `${TTS_BASE}/tts_meta.json`
const VOICE_CACHE = 'iany-voice-v1'

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
  private session: Ort.InferenceSession | null = null
  private meta: TtsMeta | null = null
  private idOf: Record<string, number> = {}
  private blankId = 0
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private speakId = 0
  status: VoiceStatus = 'off'

  get ready(): boolean {
    return this.status === 'ready' && this.session !== null
  }

  /** Is the onnx already cached (so the radio can use it without a download)? */
  async isDownloaded(): Promise<boolean> {
    try {
      const c = await caches.open(VOICE_CACHE)
      return (await c.match(TTS_ONNX)) != null
    } catch {
      return false
    }
  }

  /** Download (once) + load the ONNX voice. Safe to call repeatedly. */
  async init(onProgress?: (p: VoiceProgress) => void): Promise<void> {
    if (this.ready) return
    try {
      const rt = await loadOrt()
      rt.env.wasm.wasmPaths = `${location.origin}/ort/`
      rt.env.wasm.numThreads = 1
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
      this.session = await rt.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
      this.status = 'ready'
      onProgress?.({ status: 'ready' })
    } catch (e) {
      this.status = 'error'
      onProgress?.({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  /** Stream the onnx from the Cache API (or fetch + cache it) with progress. */
  private async loadOnnx(onProgress: (f: number) => void): Promise<Uint8Array> {
    const cache = await caches.open(VOICE_CACHE)
    let res = await cache.match(TTS_ONNX)
    if (!res) {
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
      await cache.put(TTS_ONNX, new Response(new Blob(chunks as BlobPart[])))
      res = await cache.match(TTS_ONNX)
    } else {
      onProgress(1)
    }
    return new Uint8Array(await res!.arrayBuffer())
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

  private async synth(ids: number[]): Promise<Float32Array> {
    // The onnx declares int64 inputs — feed BigInt64Array (as on mobile).
    const rt = ort! // set during init() before any synth
    const x = new rt.Tensor('int64', BigInt64Array.from(ids, (v) => BigInt(v)), [1, ids.length])
    const xl = new rt.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1])
    const out = await this.session!.run({ x, x_lengths: xl })
    const y = out.y ?? out[Object.keys(out)[0]]
    return y.data as Float32Array
  }

  /** Speak the full text, streaming sentence-by-sentence. */
  async speak(text: string): Promise<void> {
    if (!this.session || !this.meta) throw new Error('voice not ready')
    this.stop()
    const myId = ++this.speakId
    if (!this.ctx) this.ctx = new AudioContext()
    await this.ctx.resume().catch(() => {})
    const sentences = splitSentences(text)
      .map((s) => this.textToIds(s))
      .filter((a) => a.length > 0)
    if (sentences.length === 0) return
    let pcm = await this.synth(sentences[0])
    for (let i = 0; i < sentences.length; i++) {
      if (myId !== this.speakId) return // superseded
      const next = i + 1 < sentences.length ? this.synth(sentences[i + 1]) : null
      await this.play(pcm, myId)
      if (myId !== this.speakId || !next) return
      pcm = await next
    }
  }

  private play(pcm: Float32Array, myId: number): Promise<void> {
    return new Promise((resolve) => {
      const ctx = this.ctx!
      const buf = ctx.createBuffer(1, pcm.length, this.meta!.sample_rate)
      buf.getChannelData(0).set(pcm)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.onended = () => resolve()
      this.source = src
      if (myId !== this.speakId) {
        resolve()
        return
      }
      src.start()
    })
  }

  stop(): void {
    this.speakId++
    if (this.source) {
      try {
        this.source.stop()
      } catch {
        /* already stopped */
      }
      this.source = null
    }
  }
}

export const khmerTts = new KhmerOnnxTts()
