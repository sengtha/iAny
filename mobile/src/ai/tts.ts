import * as FileSystem from 'expo-file-system'
import { Audio } from 'expo-av'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { TTS_META_FILE, TTS_MODEL_REPO, TTS_ONNX_FILE } from '../domain/types'
import { ensureFile, errStr, fetchModelJson } from './modelFile'

/**
 * On-device Khmer text-to-speech via onnxruntime-react-native running our VITS
 * voice (khmer_tts.onnx). Fully offline once downloaded.
 *
 * The model takes grapheme token ids (int32) → a float32 waveform. We replicate
 * the coqui training tokenizer in JS from tts_meta.json: lowercase + collapse
 * whitespace (basic_cleaners), char→id via the vocab, drop unknown chars, then
 * interleave the blank token if `add_blank`. The waveform is wrapped in a WAV
 * header and played through expo-av.
 */

export type TtsStatus = 'off' | 'downloading' | 'loading' | 'ready' | 'error'

export interface TtsProgress {
  status: TtsStatus
  progress?: number
  error?: string
}

interface TtsMeta {
  vocab: string[]
  add_blank: boolean
  sample_rate: number
  blank: string
}

/** base64 without btoa/Buffer (neither exists in Hermes). */
function toBase64(bytes: Uint8Array): string {
  const C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  const n = bytes.length
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < n ? bytes[i + 1] : 0
    const b2 = i + 2 < n ? bytes[i + 2] : 0
    out += C[b0 >> 2]
    out += C[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < n ? C[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < n ? C[b2 & 63] : '='
  }
  return out
}

class KhmerTts {
  private session: InferenceSession | null = null
  private meta: TtsMeta | null = null
  private idOf: Record<string, number> = {}
  private blankId = 0
  private sound: Audio.Sound | null = null
  status: TtsStatus = 'off'

  get ready(): boolean {
    return this.status === 'ready' && this.session !== null
  }

  /** Download (once) + load the ONNX voice. Safe to call repeatedly. */
  async init(onProgress?: (p: TtsProgress) => void): Promise<void> {
    if (this.ready) return
    try {
      this.status = 'downloading'
      onProgress?.({ status: 'downloading', progress: 0 })
      this.meta = await fetchModelJson<TtsMeta>(TTS_MODEL_REPO, TTS_META_FILE)
      this.idOf = {}
      this.meta.vocab.forEach((c, i) => {
        this.idOf[c] = i
      })
      this.blankId = this.idOf[this.meta.blank] ?? 0
      const onnxPath = await ensureFile(TTS_MODEL_REPO, TTS_ONNX_FILE, (f) =>
        onProgress?.({ status: 'downloading', progress: f }),
      )
      this.status = 'loading'
      onProgress?.({ status: 'loading' })
      this.session = await InferenceSession.create(onnxPath)
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {})
      this.status = 'ready'
      onProgress?.({ status: 'ready' })
    } catch (e) {
      this.status = 'error'
      onProgress?.({ status: 'error', error: errStr(e) })
      throw e
    }
  }

  /** Khmer text → grapheme token ids, matching the training tokenizer. */
  private textToIds(text: string): number[] {
    const clean = text.toLowerCase().replace(/\s+/g, ' ').trim()
    const ids: number[] = []
    for (const ch of clean) {
      const id = this.idOf[ch]
      if (id !== undefined) ids.push(id) // drop unknown chars, like coqui
    }
    if (this.meta?.add_blank) {
      const out: number[] = [this.blankId]
      for (const id of ids) {
        out.push(id, this.blankId)
      }
      return out
    }
    return ids
  }

  /** Split into sentence-length chunks. The voice was TRAINED on ~8s sentence
   *  clips, so synthesizing a whole paragraph at once sounds unnatural (out of
   *  distribution); per-sentence synthesis matches training and adds real pauses. */
  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[។!?.\n])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  private async synth(ids: number[]): Promise<Float32Array> {
    const x = new Tensor('int32', Int32Array.from(ids), [1, ids.length])
    const xLen = new Tensor('int32', Int32Array.from([ids.length]), [1])
    const out = await this.session!.run({ x, x_lengths: xLen })
    const y = out.y ?? out[Object.keys(out)[0]]
    return y.data as Float32Array // [1,1,T] flattened -> T
  }

  /**
   * Synthesize the text sentence-by-sentence (natural pacing) and play it as one
   * clip. No-op for empty/all-unknown input.
   */
  async speak(text: string): Promise<void> {
    if (!this.session || !this.meta) throw new Error('TTS not ready')
    const gap = Math.floor(this.meta.sample_rate * 0.12) // 120ms between sentences
    const chunks: Float32Array[] = []
    for (const s of this.splitSentences(text)) {
      const ids = this.textToIds(s)
      if (ids.length === 0) continue
      chunks.push(await this.synth(ids), new Float32Array(gap))
    }
    if (chunks.length === 0) return
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const pcm = new Float32Array(total)
    let o = 0
    for (const c of chunks) {
      pcm.set(c, o)
      o += c.length
    }
    const path = await this.writeWav(pcm, this.meta.sample_rate)
    await this.play(path)
  }

  /** Release the session so a redownload re-initializes from a fresh file. */
  async reset(): Promise<void> {
    await this.stop()
    this.session = null
    this.meta = null
    this.status = 'off'
  }

  async stop(): Promise<void> {
    if (this.sound) {
      await this.sound.stopAsync().catch(() => {})
      await this.sound.unloadAsync().catch(() => {})
      this.sound = null
    }
  }

  private async writeWav(pcm: Float32Array, sr: number): Promise<string> {
    const n = pcm.length
    const buf = new ArrayBuffer(44 + n * 2)
    const dv = new DataView(buf)
    const w = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i))
    }
    w(0, 'RIFF')
    dv.setUint32(4, 36 + n * 2, true)
    w(8, 'WAVE')
    w(12, 'fmt ')
    dv.setUint32(16, 16, true)
    dv.setUint16(20, 1, true) // PCM
    dv.setUint16(22, 1, true) // mono
    dv.setUint32(24, sr, true)
    dv.setUint32(28, sr * 2, true) // byte rate
    dv.setUint16(32, 2, true) // block align
    dv.setUint16(34, 16, true) // bits per sample
    w(36, 'data')
    dv.setUint32(40, n * 2, true)
    let o = 44
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]))
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
    const path = `${FileSystem.cacheDirectory}tts.wav`
    await FileSystem.writeAsStringAsync(path, toBase64(new Uint8Array(buf)), {
      encoding: FileSystem.EncodingType.Base64,
    })
    return path
  }

  private async play(uri: string): Promise<void> {
    await this.stop()
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true })
    this.sound = sound
  }
}

export const tts = new KhmerTts()
