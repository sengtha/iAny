/**
 * Mic → 16 kHz mono 16-bit WAV, in the browser.
 *
 * Captures PCM directly from the Web Audio graph (a ScriptProcessorNode) rather
 * than recording webm/opus and decoding it — decoding MediaRecorder output is
 * flaky across browsers, and direct PCM gives us clean, downsample-ready audio
 * plus a live level for the VU meter. Trims leading/trailing silence.
 *
 * No dependencies; runs on any modern mobile/Chromebook browser with a mic.
 */

const TARGET_SR = 16000
const BUF = 4096

export interface RecordedClip {
  /** 16 kHz mono 16-bit PCM WAV. */
  wav: Blob
  /** 16 kHz mono float samples (−1..1) — for transformers.js ASR, which wants
   *  a Float32Array rather than an encoded file. */
  samples: Float32Array
  /** Seconds of audio after silence trim. */
  durationSec: number
  /** Peak absolute sample (0–1) — lets the UI flag "too quiet". */
  peak: number
}

export interface VoiceRecorderOptions {
  /** Called each audio block with the current input level (0–1) for a meter. */
  onLevel?: (level: number) => void
}

export class VoiceRecorder {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private blocks: Float32Array[] = []
  private srcSampleRate = 48000
  private recording = false
  private readonly opts: VoiceRecorderOptions

  constructor(opts: VoiceRecorderOptions = {}) {
    this.opts = opts
  }

  static isSupported(): boolean {
    const AC =
      typeof window !== 'undefined' &&
      (window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
    return (
      typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!AC
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
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new AC()
    // Autoplay policies can leave the context suspended until a gesture; the
    // Record tap is that gesture, so resume explicitly.
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.srcSampleRate = this.ctx.sampleRate

    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.processor = this.ctx.createScriptProcessor(BUF, 1, 1)
    // A muted sink keeps the processor in a graph that reaches destination (so
    // onaudioprocess fires) without echoing the mic back to the speakers.
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0

    this.blocks = []
    this.recording = true
    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.recording) return
      const input = e.inputBuffer.getChannelData(0)
      this.blocks.push(new Float32Array(input))
      if (this.opts.onLevel) {
        let sum = 0
        for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!
        this.opts.onLevel(Math.min(1, Math.sqrt(sum / input.length) * 3))
      }
    }
    this.source.connect(this.processor)
    this.processor.connect(this.sink)
    this.sink.connect(this.ctx.destination)
  }

  /** Stop, concatenate, downsample to 16 kHz, trim silence, WAV-encode. */
  async stop(): Promise<RecordedClip> {
    this.recording = false
    const from = this.srcSampleRate
    this.teardown()

    const raw = concat(this.blocks)
    this.blocks = []
    const down = downsample(raw, from, TARGET_SR)
    const trimmed = trimSilence(down)
    let peak = 0
    for (let i = 0; i < trimmed.length; i++) {
      const a = Math.abs(trimmed[i]!)
      if (a > peak) peak = a
    }
    return {
      wav: encodeWav(trimmed, TARGET_SR),
      samples: trimmed,
      durationSec: trimmed.length / TARGET_SR,
      peak,
    }
  }

  /** Abort without producing a clip (e.g. the user cancels). */
  cancel(): void {
    this.recording = false
    this.blocks = []
    this.teardown()
  }

  private teardown(): void {
    try {
      this.processor?.disconnect()
      this.source?.disconnect()
      this.sink?.disconnect()
    } catch {
      /* ignore */
    }
    if (this.processor) this.processor.onaudioprocess = null
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.ctx) void this.ctx.close()
    this.processor = null
    this.source = null
    this.sink = null
    this.ctx = null
    this.stream = null
  }
}

function concat(blocks: Float32Array[]): Float32Array {
  let n = 0
  for (const b of blocks) n += b.length
  const out = new Float32Array(n)
  let off = 0
  for (const b of blocks) {
    out.set(b, off)
    off += b.length
  }
  return out
}

/** Linear-interpolation resample (fine for speech at these rates). */
function downsample(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to || data.length === 0) return data
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
  if (data.length === 0) return data
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
