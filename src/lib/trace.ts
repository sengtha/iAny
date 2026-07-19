/**
 * iAny Trace — keyless, offline "proof of origin" as a **trust score**.
 *
 * Philosophy: no single signal is treated as proof of truth. At create time we
 * capture many weak signals from the product (photos → perceptual signatures,
 * color, the printed box text, GPS, a producer note) into a **content-addressed
 * capsule** (its id is the SHA-256 of its own contents — keyless tamper-evidence,
 * no signing keys to manage). At verify time we re-capture the *matchable*
 * signals and combine their similarities into a single **trust score (0–100)**
 * with a transparent breakdown.
 *
 * Honest scope: the score measures *consistency with the documented origin*, not
 * authenticity of the origin claim. Context signals (GPS/time/producer) are shown
 * but not scored (the item has moved). Everything here runs on-device, offline.
 *
 * v1 uses dependency-free perceptual signatures (dHash + colour histogram); the
 * `photoSignature` step is the one place to later swap in a learned image
 * embedding for higher accuracy without changing the capsule shape or scoring.
 */

/* ----------------------------------------------------------------- types --- */

export interface PhotoSig {
  /** 160px JPEG data URL — lets the verifier see the origin photo side-by-side. */
  thumb: string
  /** 64-bit difference hash, hex. Robust to lighting/scale; compares by Hamming. */
  dhash: string
  /** 64-bin (4×4×4) normalized RGB colour histogram. */
  hist: number[]
}

export interface TraceCapsule {
  v: 1
  /** Matchable signals — re-captured and scored at verify. */
  match: {
    photos: PhotoSig[]
    /** Normalized text read from the box/label (OCR or typed). */
    boxText: string
  }
  /** Context — recorded once, shown but NOT scored (self-reported claims). */
  context: {
    gps: { lat: number; lng: number; acc: number } | null
    capturedAt: string // device clock — a claim, not trusted time
    producer: string
    product: string
    note: string
  }
  /** Content id = SHA-256 of everything above (keyless integrity). */
  id: string
}

export interface SignalScore {
  key: string
  label: string
  score: number // 0..1
  weight: number
  available: boolean
}

export interface VerifyResult {
  /** 0..100 overall trust score across available matchable signals. */
  score: number
  band: 'strong' | 'good' | 'partial' | 'low'
  signals: SignalScore[]
  /** Did the imported capsule's contents still hash to its id? */
  integrityOk: boolean
  /** How many matchable signals were actually available on both sides. */
  usedSignals: number
}

/* ------------------------------------------------------------- hashing ----- */

const enc = new TextEncoder()

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const buf = typeof input === 'string' ? enc.encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Canonical JSON of the capsule WITHOUT its id, for content addressing. */
function canonical(capsule: Omit<TraceCapsule, 'id'>): string {
  // Stable key order; thumbs are included so the id also pins the images.
  return JSON.stringify(capsule)
}

export async function capsuleId(capsule: Omit<TraceCapsule, 'id'>): Promise<string> {
  return sha256Hex(canonical(capsule))
}

/* ------------------------------------------------- perceptual signatures --- */

function drawToData(bmp: ImageBitmap, w: number, h: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** 64-bit difference hash (dHash) as hex. Compare with hammingSimilarity. */
function dHash(bmp: ImageBitmap): string {
  const { data } = drawToData(bmp, 9, 8) // 9×8 → 8×8 adjacent comparisons = 64 bits
  const gray: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!)
  }
  let bits = ''
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const l = gray[row * 9 + col]!
      const r = gray[row * 9 + col + 1]!
      bits += l > r ? '1' : '0'
    }
  }
  // 64 bits → 16 hex chars
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** 4×4×4 = 64-bin normalized RGB colour histogram. */
function colorHistogram(bmp: ImageBitmap): number[] {
  const { data } = drawToData(bmp, 32, 32)
  const bins = new Array(64).fill(0)
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! >> 6, g = data[i + 1]! >> 6, b = data[i + 2]! >> 6
    bins[r * 16 + g * 4 + b]++
    n++
  }
  return bins.map((c) => c / (n || 1))
}

async function thumbnail(blob: Blob, max = 160): Promise<string> {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return canvas.toDataURL('image/jpeg', 0.7)
}

/** Turn a product photo into its signature (thumb + perceptual hashes). */
export async function photoSignature(blob: Blob): Promise<PhotoSig> {
  const bmp = await createImageBitmap(blob)
  const dhash = dHash(bmp)
  const hist = colorHistogram(bmp)
  bmp.close()
  const thumb = await thumbnail(blob)
  return { thumb, dhash, hist }
}

/* --------------------------------------------------------- similarities --- */

function hammingSimilarity(a: string, b: string): number {
  if (a.length !== b.length) return 0
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)
    while (x) { diff += x & 1; x >>= 1 }
  }
  return 1 - diff / 64
}

/** Histogram intersection (both normalized) → 0..1. */
function histSimilarity(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.min(a[i] ?? 0, b[i] ?? 0)
  return s
}

/** Best visual+colour match of one fresh photo against all origin photos. */
function bestPhotoMatch(fresh: PhotoSig, origins: PhotoSig[]): { v: number; c: number } {
  let best = { v: 0, c: 0, sum: -1 }
  for (const o of origins) {
    const v = hammingSimilarity(fresh.dhash, o.dhash)
    const c = histSimilarity(fresh.hist, o.hist)
    const sum = v + c
    if (sum > best.sum) best = { v, c, sum }
  }
  return { v: best.v, c: best.c }
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Character-level Dice coefficient (bigrams) → 0..1, forgiving of OCR noise. */
export function textSimilarity(a: string, b: string): number {
  a = normalize(a); b = normalize(b)
  if (!a && !b) return 1
  if (!a || !b) return 0
  if (a === b) return 1
  const grams = (s: string) => {
    const g = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2)
      g.set(k, (g.get(k) ?? 0) + 1)
    }
    return g
  }
  const ga = grams(a), gb = grams(b)
  let inter = 0
  for (const [k, n] of ga) inter += Math.min(n, gb.get(k) ?? 0)
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0)
  return total ? (2 * inter) / total : 0
}

/* --------------------------------------------------------- trust score ---- */

const WEIGHTS = { visual: 0.5, color: 0.25, text: 0.25 }

export interface FreshCapture {
  photos: PhotoSig[]
  boxText: string
}

/** Combine all available matchable signals into a single trust score. */
export function computeTrust(capsule: TraceCapsule, fresh: FreshCapture, integrityOk: boolean): VerifyResult {
  const signals: SignalScore[] = []

  const haveVisual = capsule.match.photos.length > 0 && fresh.photos.length > 0
  let visual = 0, color = 0
  if (haveVisual) {
    const matches = fresh.photos.map((f) => bestPhotoMatch(f, capsule.match.photos))
    visual = matches.reduce((s, m) => s + m.v, 0) / matches.length
    color = matches.reduce((s, m) => s + m.c, 0) / matches.length
  }
  signals.push({ key: 'visual', label: 'Product appearance', score: visual, weight: WEIGHTS.visual, available: haveVisual })
  signals.push({ key: 'color', label: 'Colour / material', score: color, weight: WEIGHTS.color, available: haveVisual })

  const haveText = !!normalize(capsule.match.boxText) && !!normalize(fresh.boxText)
  const text = haveText ? textSimilarity(capsule.match.boxText, fresh.boxText) : 0
  signals.push({ key: 'text', label: 'Box / label text', score: text, weight: WEIGHTS.text, available: haveText })

  // Weighted average over AVAILABLE signals only (missing → lower ceiling).
  const avail = signals.filter((s) => s.available)
  const wsum = avail.reduce((s, x) => s + x.weight, 0)
  let raw = wsum ? avail.reduce((s, x) => s + x.score * x.weight, 0) / wsum : 0

  // Confidence penalty: fewer independent signals = less trustworthy.
  const coverage = Math.min(1, avail.length / 3) // 3 matchable signals available in v1
  let score = Math.round(raw * (0.7 + 0.3 * coverage) * 100)

  // Tampered capsule caps the score hard.
  if (!integrityOk) score = Math.min(score, 15)

  const band: VerifyResult['band'] =
    score >= 85 ? 'strong' : score >= 70 ? 'good' : score >= 45 ? 'partial' : 'low'

  return { score, band, signals, integrityOk, usedSignals: avail.length }
}
