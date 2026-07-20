/**
 * Lightweight, dependency-free image checks for the OCR collector (/scan):
 *   1. A quality gate — flag blurry / too dark / washed-out / low-contrast photos
 *      before OCR, so contributors capture images that actually train a good model.
 *   2. Near-duplicate detection — a 64-bit perceptual hash (pHash) so the same
 *      photo isn't submitted twice.
 *
 * Both run on-device in a few milliseconds with no model download — pHash is the
 * right tool for "is this the same photo" (a learned embedder would false-flag
 * different pages that merely look alike), and a Laplacian-variance sharpness
 * score is the classic, reliable blur signal. Everything is computed on a small
 * downscaled copy, so thresholds are resolution-independent.
 */

export interface ImageQuality {
  /** 64-bit DCT perceptual hash, 16 hex chars — for near-duplicate detection. */
  phash: string
  /** Variance of the Laplacian on a 256px grayscale copy — higher = sharper. */
  sharpness: number
  /** Mean luminance, 0..255. */
  brightness: number
  /** Std-dev of luminance, 0..255 — a proxy for contrast. */
  contrast: number
}

export type OcrWarning = 'blurry' | 'dark' | 'bright' | 'lowContrast'

export interface OcrGate {
  /** True when no quality problems were detected. */
  ok: boolean
  warnings: OcrWarning[]
}

// Thresholds are deliberately lenient — the gate only WARNS (never blocks), so a
// rare false positive just shows a dismissable hint.
const MIN_SHARPNESS = 90
const MIN_BRIGHTNESS = 50
const MAX_BRIGHTNESS = 215
const MIN_CONTRAST = 28

const WORK = 256 // long-edge working size for sharpness/brightness/contrast
const HASH = 32 // resize for the DCT perceptual hash

/** Compute quality metrics + perceptual hash for a photo. */
export async function analyzeImage(blob: Blob): Promise<ImageQuality> {
  const bmp = await createImageBitmap(blob)

  // --- working grayscale for sharpness / brightness / contrast ---
  const scale = Math.min(1, WORK / Math.max(bmp.width, bmp.height))
  const w = Math.max(8, Math.round(bmp.width * scale))
  const h = Math.max(8, Math.round(bmp.height * scale))
  const gray = toGray(bmp, w, h)

  let sum = 0
  for (let i = 0; i < gray.length; i++) sum += gray[i]!
  const brightness = sum / gray.length
  let varSum = 0
  for (let i = 0; i < gray.length; i++) {
    const d = gray[i]! - brightness
    varSum += d * d
  }
  const contrast = Math.sqrt(varSum / gray.length)
  const sharpness = laplacianVariance(gray, w, h)

  // --- perceptual hash (independent 32×32 pass) ---
  const small = toGray(bmp, HASH, HASH)
  bmp.close()
  const phash = dctHash(small)

  return { phash, sharpness, brightness, contrast }
}

/** Turn quality metrics into (non-blocking) OCR warnings. */
export function assessOcr(q: ImageQuality): OcrGate {
  const warnings: OcrWarning[] = []
  if (q.sharpness < MIN_SHARPNESS) warnings.push('blurry')
  if (q.brightness < MIN_BRIGHTNESS) warnings.push('dark')
  else if (q.brightness > MAX_BRIGHTNESS) warnings.push('bright')
  if (q.contrast < MIN_CONTRAST) warnings.push('lowContrast')
  return { ok: warnings.length === 0, warnings }
}

/* --------------------------------------------------------- near-duplicate --- */

/** Number of differing bits between two equal-length hex hashes. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)
    while (x) {
      diff += x & 1
      x >>= 1
    }
  }
  return diff
}

/** Return the first seen hash within `maxBits` of `phash` (a near-duplicate), else null. */
export function nearDuplicate(phash: string, seen: string[], maxBits = 6): string | null {
  for (const s of seen) if (hammingHex(phash, s) <= maxBits) return s
  return null
}

/* ------------------------------------------------ submitted-hash memory ----- */

const STORE_KEY = 'iany.ocr.phashes'
const STORE_CAP = 400

/** Load this device's recently-submitted perceptual hashes. */
export function loadSubmittedHashes(): string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/** Remember a submitted hash (capped, most-recent-first). */
export function rememberHash(phash: string): void {
  try {
    const list = loadSubmittedHashes().filter((h) => h !== phash)
    list.unshift(phash)
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, STORE_CAP)))
  } catch {
    /* private mode — dedup just won't persist */
  }
}

/* -------------------------------------------------------------- internals --- */

function toGray(bmp: ImageBitmap, w: number, h: number): Float64Array {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const gray = new Float64Array(w * h)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
  }
  return gray
}

/** Variance of a 3×3 Laplacian response — the standard blur metric. */
function laplacianVariance(gray: Float64Array, w: number, h: number): number {
  const lap: number[] = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!
      lap.push(v)
    }
  }
  if (!lap.length) return 0
  let m = 0
  for (const v of lap) m += v
  m /= lap.length
  let s = 0
  for (const v of lap) {
    const d = v - m
    s += d * d
  }
  return s / lap.length
}

/** 64-bit DCT perceptual hash from a HASH×HASH grayscale plane. */
function dctHash(gray: Float64Array): string {
  const N = HASH
  const cos = dctBasis(N)
  const rows = new Float64Array(N * N)
  const tmp = new Float64Array(N)
  // rows
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < N; u++) {
      let sum = 0
      for (let x = 0; x < N; x++) sum += gray[y * N + x]! * cos[u * N + x]!
      tmp[u] = sum
    }
    for (let u = 0; u < N; u++) rows[y * N + u] = tmp[u]!
  }
  // cols
  const dct = new Float64Array(N * N)
  for (let x = 0; x < N; x++) {
    for (let u = 0; u < N; u++) {
      let sum = 0
      for (let y = 0; y < N; y++) sum += rows[y * N + x]! * cos[u * N + y]!
      tmp[u] = sum
    }
    for (let u = 0; u < N; u++) dct[u * N + x] = tmp[u]!
  }
  // top-left 8×8 low-frequency block, excluding DC → median threshold → 64 bits
  const block: number[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (x || y) block.push(dct[y * N + x]!)
  const median = [...block].sort((a, b) => a - b)[Math.floor(block.length / 2)]!
  let bits = ''
  for (let k = 0; k < 64; k++) bits += (block[k] ?? 0) > median ? '1' : '0'
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

let basisCache: { n: number; cos: Float64Array } | null = null
function dctBasis(n: number): Float64Array {
  if (basisCache && basisCache.n === n) return basisCache.cos
  const cos = new Float64Array(n * n)
  for (let u = 0; u < n; u++) {
    for (let x = 0; x < n; x++) cos[u * n + x] = Math.cos((Math.PI / n) * (x + 0.5) * u)
  }
  basisCache = { n, cos }
  return cos
}
