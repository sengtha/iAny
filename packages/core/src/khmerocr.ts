/**
 * Khmer OCR — the platform-agnostic pre/post-processing for seanghay's KhmerOCR
 * ONNX models (MIT), shared by the PWA and mobile so both read scans identically.
 *
 * Pipeline: a YOLO-style detector (det.onnx) finds text/figure boxes in a page;
 * a CRNN+CTC recognizer (rec.onnx) reads each text box. Everything here is pure
 * math on RGBA pixel buffers — the platform only has to (a) decode an image to
 * RGBA and (b) run the two ONNX sessions. Ported 1:1 from the reference Python
 * and verified end-to-end against onnxruntime.
 */

/** Recognizer charset: CTC class `i` maps to TOKENS[i - 3] (0=blank, 1..2 special). */
export const OCR_TOKENS =
  'កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវឝឞសហឡអឣឤឥឦឧឩឪឫឬឭឮឯឰឱឲឳាិីឹឺុូួើឿៀេែៃោៅំះៈ៉៊់៌៍៎៏័៑្។៕៖ៗ៘៛៝០១២៣៤៥៦៧៨៩៳'

export const OCR_FONTS = ['Regular', 'Italic', 'Bold', 'BoldItalic', 'Moul', 'MoulLight'] as const

export const DET_SIZE = 1024 // detector input is a fixed 1024×1024 letterbox
export const REC_HEIGHT = 32 // recognizer input height; width is proportional
export const DET_NUM_CLASSES = 2 // class 0 = figure/image, class 1 = text
export const REC_NUM_CLASSES = 102
const DET_SCORE_THRESH = 0.25
const DET_NMS_IOU = 0.45

/** Decoded image as tightly-packed RGBA (4 bytes/pixel), row-major. */
export interface OcrImage {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

/** A detection box in ORIGINAL image coordinates. */
export interface OcrBox {
  x1: number
  y1: number
  x2: number
  y2: number
  cls: number
  score: number
}

/* ---- Detection input: letterbox to 1024×1024, CHW float /255 -------------- */

/**
 * Resize the page to fit inside 1024×1024 (aspect-preserving), paste at the
 * top-left of a black canvas, and lay it out as a [1,3,1024,1024] tensor. The
 * returned `ratio` scales detector boxes back to original coordinates.
 */
export function buildDetInput(img: OcrImage): { input: Float32Array; ratio: number } {
  const ratio = Math.min(DET_SIZE / img.width, DET_SIZE / img.height)
  const newW = Math.round(img.width * ratio)
  const newH = Math.round(img.height * ratio)
  const plane = DET_SIZE * DET_SIZE
  const input = new Float32Array(3 * plane) // zero-filled = black padding
  for (let dy = 0; dy < newH; dy++) {
    for (let dx = 0; dx < newW; dx++) {
      const [r, g, b] = sampleBilinear(img, ((dx + 0.5) * img.width) / newW - 0.5, ((dy + 0.5) * img.height) / newH - 0.5)
      const o = dy * DET_SIZE + dx
      input[o] = r / 255
      input[plane + o] = g / 255
      input[2 * plane + o] = b / 255
    }
  }
  return { input, ratio }
}

/* ---- Detection output: parse anchors → boxes → NMS → original coords ------ */

/**
 * Parse the detector's [1, 4+numClasses, numAnchors] output into boxes.
 * Columns per anchor are [cx, cy, w, h, class scores…]; keep the best class,
 * threshold, convert to xyxy, NMS, then divide by `ratio` for original coords.
 */
export function parseDetections(
  output: Float32Array,
  numAnchors: number,
  ratio: number,
): OcrBox[] {
  const stride = DET_NUM_CLASSES + 4
  const cand: OcrBox[] = []
  for (let a = 0; a < numAnchors; a++) {
    let best = 0
    let bestCls = 0
    for (let c = 0; c < DET_NUM_CLASSES; c++) {
      const p = output[(4 + c) * numAnchors + a]
      if (p > best) {
        best = p
        bestCls = c
      }
    }
    if (best <= DET_SCORE_THRESH) continue
    const cx = output[a]
    const cy = output[numAnchors + a]
    const w = output[2 * numAnchors + a]
    const h = output[3 * numAnchors + a]
    cand.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, cls: bestCls, score: best })
  }
  void stride
  const kept = nms(cand, DET_NMS_IOU)
  for (const b of kept) {
    b.x1 /= ratio
    b.y1 /= ratio
    b.x2 /= ratio
    b.y2 /= ratio
  }
  return kept
}

function nms(boxes: OcrBox[], iouThresh: number): OcrBox[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b].score - boxes[a].score)
  const area = (b: OcrBox) => (b.x2 - b.x1) * (b.y2 - b.y1)
  const keep: OcrBox[] = []
  const dead = new Set<number>()
  for (let i = 0; i < order.length; i++) {
    const bi = order[i]
    if (dead.has(bi)) continue
    const a = boxes[bi]
    keep.push(a)
    for (let j = i + 1; j < order.length; j++) {
      const bj = order[j]
      if (dead.has(bj)) continue
      const b = boxes[bj]
      const xx1 = Math.max(a.x1, b.x1)
      const yy1 = Math.max(a.y1, b.y1)
      const xx2 = Math.min(a.x2, b.x2)
      const yy2 = Math.min(a.y2, b.y2)
      const inter = Math.max(0, xx2 - xx1) * Math.max(0, yy2 - yy1)
      const ovr = inter / (area(a) + area(b) - inter)
      if (ovr > iouThresh) dead.add(bj)
    }
  }
  return keep
}

/**
 * Group boxes into reading-order lines (top→bottom, then left→right within a
 * line), mirroring the reference `get_sorted_lines`.
 */
export function sortIntoLines(boxes: OcrBox[], thresholdRatio = 0.5): OcrBox[][] {
  if (boxes.length === 0) return []
  const key = (b: OcrBox) => (b.cls === 0 ? b.y2 : b.y1)
  const sorted = [...boxes].sort((a, b) => key(a) - key(b))
  const lines: OcrBox[][] = []
  let current: OcrBox[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = current[current.length - 1]
    const curr = sorted[i]
    const refH = prev.y2 - prev.y1
    if (Math.abs(key(curr) - key(prev)) < refH * thresholdRatio) {
      current.push(curr)
    } else {
      lines.push(current.sort((a, b) => a.x1 - b.x1))
      current = [curr]
    }
  }
  lines.push(current.sort((a, b) => a.x1 - b.x1))
  return lines
}

/* ---- Recognition input: crop → grayscale → resize to height 32 ------------ */

/**
 * Crop a box from the original page, convert to grayscale, and resize to a
 * height-32 strip (width proportional) as a [1,1,32,W] float tensor.
 */
export function buildRecInput(img: OcrImage, box: OcrBox): { input: Float32Array; width: number } {
  const x1 = clamp(Math.round(box.x1), 0, img.width - 1)
  const y1 = clamp(Math.round(box.y1), 0, img.height - 1)
  const x2 = clamp(Math.round(box.x2), x1 + 1, img.width)
  const y2 = clamp(Math.round(box.y2), y1 + 1, img.height)
  const cw = x2 - x1
  const ch = y2 - y1
  const width = Math.max(1, Math.round((cw / ch) * REC_HEIGHT))
  const input = new Float32Array(REC_HEIGHT * width)
  for (let y = 0; y < REC_HEIGHT; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x1 + ((x + 0.5) * cw) / width - 0.5
      const sy = y1 + ((y + 0.5) * ch) / REC_HEIGHT - 0.5
      const [r, g, b] = sampleBilinear(img, sx, sy)
      // PIL "L" luma (ITU-R 601-2), matching the reference preprocessing.
      input[y * width + x] = (r * 299 + g * 587 + b * 114) / 1000 / 255
    }
  }
  return { input, width }
}

/* ---- Recognition output: greedy CTC decode -------------------------------- */

/** Decoded line + how sure the recognizer was (mean softmax prob of emitted glyphs). */
export interface OcrDecode {
  text: string
  confidence: number
}

/** Khmer consonants + independent vowels — a real Khmer line has at least one. */
const KHMER_LETTER = /[ក-ឳ]/
export function hasKhmerLetter(s: string): boolean {
  return KHMER_LETTER.test(s)
}

/** Drop a recognized line whose mean confidence is below this — it's noise the
 *  recognizer force-read into random glyphs/digits (the "unknown numbers"). */
export const OCR_REC_MIN_CONFIDENCE = 0.5

/**
 * Greedy CTC decode of the recognizer logits [seqLen, 1, REC_NUM_CLASSES]:
 * argmax per step, collapse repeats, drop blanks (class 0), map class→glyph.
 * Also returns the mean softmax probability of the emitted glyphs, so callers
 * can drop low-confidence lines (real-photo noise → garbage) instead of showing
 * them.
 */
export function ctcDecode(
  logits: Float32Array,
  seqLen: number,
  numClasses = REC_NUM_CLASSES,
): OcrDecode {
  let out = ''
  let prev = -1
  let confSum = 0
  let confN = 0
  for (let t = 0; t < seqLen; t++) {
    const base = t * numClasses
    let idx = 0
    let bestVal = -Infinity
    for (let c = 0; c < numClasses; c++) {
      const v = logits[base + c]
      if (v > bestVal) {
        bestVal = v
        idx = c
      }
    }
    if (idx !== prev) {
      if (idx >= 3 && idx - 3 < OCR_TOKENS.length) {
        out += OCR_TOKENS[idx - 3]
        // softmax prob of the chosen class = confidence at this step
        let denom = 0
        for (let c = 0; c < numClasses; c++) denom += Math.exp(logits[base + c] - bestVal)
        confSum += 1 / denom
        confN++
      }
      prev = idx
    }
  }
  return { text: out, confidence: confN ? confSum / confN : 0 }
}

/* ---- helpers -------------------------------------------------------------- */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Bilinear RGB sample with edge clamping. Returns [r,g,b] in 0..255. */
function sampleBilinear(img: OcrImage, fx: number, fy: number): [number, number, number] {
  const { data, width, height } = img
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const dx = fx - x0
  const dy = fy - y0
  const x0c = clamp(x0, 0, width - 1)
  const x1c = clamp(x0 + 1, 0, width - 1)
  const y0c = clamp(y0, 0, height - 1)
  const y1c = clamp(y0 + 1, 0, height - 1)
  const at = (x: number, y: number, ch: number) => data[(y * width + x) * 4 + ch]
  let r = 0
  let g = 0
  let b = 0
  const w00 = (1 - dx) * (1 - dy)
  const w10 = dx * (1 - dy)
  const w01 = (1 - dx) * dy
  const w11 = dx * dy
  r = at(x0c, y0c, 0) * w00 + at(x1c, y0c, 0) * w10 + at(x0c, y1c, 0) * w01 + at(x1c, y1c, 0) * w11
  g = at(x0c, y0c, 1) * w00 + at(x1c, y0c, 1) * w10 + at(x0c, y1c, 1) * w01 + at(x1c, y1c, 1) * w11
  b = at(x0c, y0c, 2) * w00 + at(x1c, y0c, 2) * w10 + at(x0c, y1c, 2) * w01 + at(x1c, y1c, 2) * w11
  return [r, g, b]
}
