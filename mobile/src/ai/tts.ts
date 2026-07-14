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

/** Khmer number words. The voice was trained on Khmer audio, so it can't say
 *  Arabic/Khmer digits — we spell numbers out in Khmer before synthesis. */
const KH_UNITS = ['សូន្យ', 'មួយ', 'ពីរ', 'បី', 'បួន', 'ប្រាំ', 'ប្រាំមួយ', 'ប្រាំពីរ', 'ប្រាំបី', 'ប្រាំបួន']
const KH_TENS = ['', 'ដប់', 'ម្ភៃ', 'សាមសិប', 'សែសិប', 'ហាសិប', 'ហុកសិប', 'ចិតសិប', 'ប៉ែតសិប', 'កៅសិប']
const KH_SCALES: [number, string][] = [
  [1000000, 'លាន'],
  [100000, 'សែន'],
  [10000, 'ម៉ឺន'],
  [1000, 'ពាន់'],
  [100, 'រយ'],
]

/** Non-negative integer -> Khmer words (handles the លាន/សែន/ម៉ឺន scale system). */
function intToKhmer(n: number): string {
  if (n === 0) return KH_UNITS[0]
  if (n < 10) return KH_UNITS[n]
  if (n < 20) return 'ដប់' + (n > 10 ? KH_UNITS[n - 10] : '')
  if (n < 100) {
    const t = Math.floor(n / 10)
    const u = n % 10
    return KH_TENS[t] + (u ? KH_UNITS[u] : '')
  }
  for (const [pv, word] of KH_SCALES) {
    if (n >= pv) {
      const hi = Math.floor(n / pv)
      const lo = n % pv
      return intToKhmer(hi) + word + (lo ? intToKhmer(lo) : '')
    }
  }
  return ''
}

/** Replace digit runs (Arabic or Khmer, with , separators / . decimals) with
 *  Khmer number words so the Khmer voice can pronounce them. Speech-only. */
function normalizeNumbers(text: string): string {
  // Khmer digits (U+17E0..17E9) -> ASCII so one regex handles both.
  const ascii = text.replace(/[០-៩]/g, (d) => String(d.charCodeAt(0) - 0x17e0))
  return ascii.replace(/\d+(?:,\d{3})*(?:\.\d+)?/g, (m) => {
    const [intPart, frac] = m.replace(/,/g, '').split('.')
    const n = parseInt(intPart, 10)
    if (!Number.isFinite(n)) return m
    let words = intToKhmer(n)
    if (frac) {
      words += ' ចុច ' + [...frac].map((d) => KH_UNITS[parseInt(d, 10)] ?? '').join(' ')
    }
    return ` ${words} `
  })
}

class KhmerTts {
  private session: InferenceSession | null = null
  private meta: TtsMeta | null = null
  private idOf: Record<string, number> = {}
  private blankId = 0
  private sound: Audio.Sound | null = null
  private speakId = 0
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
    // spell numbers in Khmer first (the voice can't say raw digits), then the
    // same normalization the training tokenizer used.
    const clean = normalizeNumbers(text).toLowerCase().replace(/\s+/g, ' ').trim()
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
   * Speak the FULL text, streaming: play sentence 1 as soon as it's synthesized,
   * and synthesize the next sentence while the current one plays. Fast to start,
   * reads everything, natural pacing. A new speak()/stop() cancels this one.
   */
  async speak(text: string): Promise<void> {
    if (!this.session || !this.meta) throw new Error('TTS not ready')
    const myId = ++this.speakId
    await this.stop()
    const sentences = this.splitSentences(text)
      .map((s) => this.textToIds(s))
      .filter((ids) => ids.length > 0)
    if (sentences.length === 0) return

    let pcm = await this.synth(sentences[0])
    for (let i = 0; i < sentences.length; i++) {
      if (myId !== this.speakId) return // superseded
      const next = i + 1 < sentences.length ? this.synth(sentences[i + 1]) : null
      await this.playAndWait(pcm, myId)
      if (myId !== this.speakId || !next) return
      pcm = await next
    }
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

  /** Play a PCM chunk and resolve when it finishes (or is superseded). */
  private async playAndWait(pcm: Float32Array, myId: number): Promise<void> {
    const uri = await this.writeWav(pcm, this.meta!.sample_rate)
    if (myId !== this.speakId) return
    await this.stop()
    await new Promise<void>((resolve) => {
      Audio.Sound.createAsync({ uri }, { shouldPlay: true })
        .then(({ sound }) => {
          if (myId !== this.speakId) {
            sound.unloadAsync().catch(() => {})
            resolve()
            return
          }
          this.sound = sound
          sound.setOnPlaybackStatusUpdate((st) => {
            if (st.isLoaded && st.didJustFinish) resolve()
            else if (!st.isLoaded && (st as { error?: unknown }).error) resolve()
          })
        })
        .catch(() => resolve())
    })
  }

  private wavIndex = 0

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
    // rotate filenames so a just-finished clip's file isn't overwritten while
    // the player may still hold it.
    const path = `${FileSystem.cacheDirectory}tts_${this.wavIndex++ % 3}.wav`
    await FileSystem.writeAsStringAsync(path, toBase64(new Uint8Array(buf)), {
      encoding: FileSystem.EncodingType.Base64,
    })
    return path
  }
}

export const tts = new KhmerTts()
