import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import jpeg from 'jpeg-js'
import {
  buildDetInput,
  parseDetections,
  sortIntoLines,
  buildRecInput,
  ctcDecode,
  DET_SIZE,
  REC_HEIGHT,
  type OcrImage,
} from '@iany/core'
import { OCR_MODEL_FILES, OCR_MODEL_REPO } from '../domain/types'
import { ensureFile, errStr } from './modelFile'

/**
 * On-device Khmer OCR — reads Khmer (and Latin) text from a photo/scan using
 * seanghay's KhmerOCR ONNX models (MIT): a YOLO-style detector + a CRNN/CTC
 * recognizer, run through onnxruntime-react-native. All pre/post-processing is
 * the shared @iany/core pipeline (identical to the PWA). Fully offline once the
 * ~25 MB of models are downloaded.
 *
 * React Native has no Canvas, so we decode pixels with expo-image-manipulator
 * (native resize/orient) + jpeg-js (pure-JS RGBA decode).
 */

const OCR_REPO = OCR_MODEL_REPO
const [DET_FILE, REC_FILE] = OCR_MODEL_FILES
// Cap the decoded image: enough resolution for legible text, small enough that
// the JS decode + preprocessing loop stay reasonable on a 2019-era phone.
const MAX_SIDE = 1600

export type OcrStatus = 'off' | 'downloading' | 'loading' | 'reading' | 'ready' | 'error'
export interface OcrProgress {
  status: OcrStatus
  progress?: number
  line?: { done: number; total: number }
}

class KhmerOcrNative {
  private det: InferenceSession | null = null
  private rec: InferenceSession | null = null
  status: OcrStatus = 'off'

  get ready(): boolean {
    return this.det !== null && this.rec !== null
  }

  /** Release the loaded sessions so a delete/redownload isn't held open. */
  async reset(): Promise<void> {
    const d = this.det
    const r = this.rec
    this.det = null
    this.rec = null
    this.status = 'off'
    await (d as { release?: () => Promise<void> } | null)?.release?.().catch(() => {})
    await (r as { release?: () => Promise<void> } | null)?.release?.().catch(() => {})
  }

  /** Download (once) + load both models. */
  async init(onProgress?: (p: OcrProgress) => void): Promise<void> {
    if (this.ready) return
    try {
      this.status = 'downloading'
      const detPath = await ensureFile(OCR_REPO, DET_FILE, (f) =>
        onProgress?.({ status: 'downloading', progress: f * 0.45 }),
      )
      const recPath = await ensureFile(OCR_REPO, REC_FILE, (f) =>
        onProgress?.({ status: 'downloading', progress: 0.45 + f * 0.55 }),
      )
      this.status = 'loading'
      onProgress?.({ status: 'loading' })
      this.det = await InferenceSession.create(detPath)
      this.rec = await InferenceSession.create(recPath)
      this.status = 'ready'
    } catch (e) {
      this.status = 'error'
      throw new Error(errStr(e))
    }
  }

  /**
   * OCR one image (by URI + its pixel dimensions) → recognized text, one line
   * per detected text line.
   */
  async recognizeImage(
    uri: string,
    width: number,
    height: number,
    onProgress?: (p: OcrProgress) => void,
  ): Promise<string> {
    if (!this.ready) await this.init(onProgress)
    const img = await decodeToRgba(uri, width, height)

    const { input, ratio } = buildDetInput(img)
    const detOut = await this.det!.run({
      images: new Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]),
    })
    const o = detOut['output0'] ?? detOut[Object.keys(detOut)[0]]
    const boxes = parseDetections(o.data as unknown as Float32Array, o.dims[2] as number, ratio)
    const lines = sortIntoLines(boxes)

    const out: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const parts: string[] = []
      for (const b of lines[i]) {
        if (b.cls !== 1 || b.score < 0.5) continue
        const { input: ri, width: rw } = buildRecInput(img, b)
        const r = await this.rec!.run({ input: new Tensor('float32', ri, [1, 1, REC_HEIGHT, rw]) })
        const lg = r['logits'] ?? r[Object.keys(r)[0]]
        parts.push(ctcDecode(lg.data as unknown as Float32Array, lg.dims[0] as number))
      }
      if (parts.length) out.push(parts.join(' '))
      onProgress?.({ status: 'reading', line: { done: i + 1, total: lines.length } })
    }
    return out.join('\n')
  }
}

/** Native resize/orient → JPEG → pure-JS RGBA decode. */
async function decodeToRgba(uri: string, ow: number, oh: number): Promise<OcrImage> {
  const longest = Math.max(ow, oh)
  const actions =
    longest > MAX_SIDE
      ? [{ resize: ow >= oh ? { width: MAX_SIDE } : { height: MAX_SIDE } }]
      : []
  const res = await manipulateAsync(uri, actions, {
    base64: true,
    compress: 0.92,
    format: SaveFormat.JPEG,
  })
  const raw = jpeg.decode(base64ToBytes(res.base64 ?? ''), { useTArray: true, formatAsRGBA: true })
  return { data: raw.data, width: raw.width, height: raw.height }
}

/** base64 → bytes without atob (absent in Hermes). */
function base64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Uint8Array(256)
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const len = clean.length
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  const byteLen = Math.floor((len * 3) / 4) - pad
  const bytes = new Uint8Array(byteLen)
  let p = 0
  for (let i = 0; i < len; i += 4) {
    const a = lookup[clean.charCodeAt(i)]
    const b = lookup[clean.charCodeAt(i + 1)]
    const c = lookup[clean.charCodeAt(i + 2)]
    const d = lookup[clean.charCodeAt(i + 3)]
    const chunk = (a << 18) | (b << 12) | (c << 6) | d
    if (p < byteLen) bytes[p++] = (chunk >> 16) & 0xff
    if (p < byteLen) bytes[p++] = (chunk >> 8) & 0xff
    if (p < byteLen) bytes[p++] = chunk & 0xff
  }
  return bytes
}

export const khmerOcr = new KhmerOcrNative()
