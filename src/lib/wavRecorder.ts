/**
 * Mic → 16 kHz mono 16-bit WAV, in the browser.
 *
 * Whisper (and our Khmer STT trained on it) wants 16 kHz mono PCM. We record
 * with MediaRecorder (broadly supported), then decode + downsample + WAV-encode
 * on stop. A live RMS level is exposed for a classroom VU meter, and we trim
 * leading/trailing silence so clips are tight.
 *
 * No dependencies; runs on any modern mobile/Chromebook browser with a mic.
 */

const TARGET_SR = 16000

export interface RecordedClip {
  /** 16 kHz mono 16-bit PCM WAV. */
  wav: Blob
  /** Seconds of audio after silence trim. */
  durationSec: number
  /** Peak absolute sample (0–1) — lets the UI flag "too quiet". */
  peak: number
}

export interface VoiceRecorderOptions {
  /** Called ~30×/s with the current input level (0–1) for a live meter. */
  onLevel?: (level: number) => void
}

export class VoiceRecorder {
  private stream: MediaStream | null = null
  private rec: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private raf = 0
  private readonly opts: VoiceRecorderOptions

  constructor(opts: VoiceRecorderOptions = {}) {
    this.opts = opts
  }

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    )
  }

  /** Request the mic and start capturing. Throws if permission is denied. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    this.chunks = []
    this.rec = new MediaRecorder(this.stream)
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.rec.start()
    this.startMeter()
  }

  /** Stop, decode, downsample to 16 kHz mono, trim silence, WAV-encode. */
  async stop(): Promise<RecordedClip> {
    const rec = this.rec
    if (!rec) throw new Error('not recording')
    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }))
      rec.stop()
    })
    this.stopMeter()
    this.teardownStream()

    const audioCtx = new AudioContext()
    try {
      const decoded = await audioCtx.decodeAudioData(await blob.arrayBuffer())
      const mono = toMono(decoded)
      const down = downsample(mono, decoded.sampleRate, TARGET_SR)
      const trimmed = trimSilence(down)
      let peak = 0
      for (let i = 0; i < trimmed.length; i++) {
        const a = Math.abs(trimmed[i]!)
        if (a > peak) peak = a
      }
      return {
        wav: encodeWav(trimmed, TARGET_SR),
        durationSec: trimmed.length / TARGET_SR,
        peak,
      }
    } finally {
      void audioCtx.close()
    }
  }

  /** Abort without producing a clip (e.g. the user cancels). */
  cancel(): void {
    try {
      this.rec?.stop()
    } catch {
      /* already stopped */
    }
    this.stopMeter()
    this.teardownStream()
  }

  private startMeter(): void {
    if (!this.opts.onLevel || !this.stream) return
    this.ctx = new AudioContext()
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 512
    src.connect(this.analyser)
    const buf = new Float32Array(this.analyser.fftSize)
    const tick = () => {
      if (!this.analyser) return
      this.analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!
      this.opts.onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 3))
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopMeter(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.analyser = null
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
    }
  }

  private teardownStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.rec = null
  }
}

function toMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice()
  const n = buf.length
  const out = new Float32Array(n)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < n; i++) out[i]! += ch[i]! / buf.numberOfChannels
  }
  return out
}

/** Linear-interpolation resample (fine for speech at these rates). */
function downsample(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data
  const ratio = from / to
  const n = Math.floor(data.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, data.length - 1)
    const frac = pos - i0
    out[i] = data[i0]! * (1 - frac) + data[i1]! * frac
  }
  return out
}

/** Drop near-silence from both ends (threshold on absolute amplitude). */
function trimSilence(data: Float32Array, threshold = 0.008, padSec = 0.08): Float32Array {
  const pad = Math.floor(padSec * TARGET_SR)
  let start = 0
  let end = data.length - 1
  while (start < data.length && Math.abs(data[start]!) < threshold) start++
  while (end > start && Math.abs(data[end]!) < threshold) end--
  start = Math.max(0, start - pad)
  end = Math.min(data.length - 1, end + pad)
  if (end <= start) return data // all quiet — keep as-is rather than empty
  return data.slice(start, end + 1)
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
