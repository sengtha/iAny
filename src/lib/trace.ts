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
  /** 64-bit DCT perceptual hash (pHash), hex — robust to lighting/scale/blur. */
  phash: string
  /** L2-normalized descriptor: spatial colour grid + gradient-orientation
   *  (texture/shape) histogram. Compared by cosine — the main appearance signal. */
  vec: number[]
  /** 64-bin (4×4×4) normalized RGB colour histogram — the separate colour signal. */
  color: number[]
}

export interface TraceCapsule {
  v: 2
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
    /** Optional witness (co-op/buyer) who vouches — authenticity comes from
     *  people, not matching. Self-reported unless registered online. */
    witness: string
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

const S = 32 // working resolution for all descriptors

/** Precomputed DCT-II basis for length S (cos((π/S)(x+½)u)). */
const DCT_COS = (() => {
  const t = new Float64Array(S * S)
  for (let u = 0; u < S; u++) for (let x = 0; x < S; x++) t[u * S + x] = Math.cos((Math.PI / S) * (x + 0.5) * u)
  return t
})()

function dct1d(vec: Float64Array, out: Float64Array): void {
  for (let u = 0; u < S; u++) {
    let sum = 0
    for (let x = 0; x < S; x++) sum += vec[x]! * DCT_COS[u * S + x]!
    out[u] = sum
  }
}

/** 64-bit DCT perceptual hash from a 32×32 grayscale plane. */
function pHash(gray: Float64Array): string {
  const rows = new Float64Array(S * S)
  const row = new Float64Array(S), rout = new Float64Array(S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) row[x] = gray[y * S + x]!
    dct1d(row, rout)
    for (let x = 0; x < S; x++) rows[y * S + x] = rout[x]!
  }
  const col = new Float64Array(S), cout = new Float64Array(S)
  const dct = new Float64Array(S * S)
  for (let x = 0; x < S; x++) {
    for (let y = 0; y < S; y++) col[y] = rows[y * S + x]!
    dct1d(col, cout)
    for (let y = 0; y < S; y++) dct[y * S + x] = cout[y]!
  }
  // top-left 8×8 low-frequency block (excl. DC), threshold on its median → 64 bits
  const low: number[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (x || y) low.push(dct[y * S + x]!)
  const med = [...low].sort((a, b) => a - b)[Math.floor(low.length / 2)]!
  let bits = (dct[0]! > med ? '1' : '0')
  for (const v of low) bits += v > med ? '1' : '0'
  bits = bits.slice(0, 64)
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

function l2normalize(v: number[]): number[] {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Full v2 descriptor: pHash + spatial-colour + gradient-orientation vector. */
function features(bmp: ImageBitmap): { phash: string; vec: number[]; color: number[] } {
  const { data } = drawToData(bmp, S, S)
  const gray = new Float64Array(S * S)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
  }

  const phash = pHash(gray)

  // Spatial colour: 4×4 grid of mean R,G,B (captures layout, not just palette).
  const grid = 4, cell = S / grid
  const spatial: number[] = []
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    let r = 0, g = 0, b = 0, n = 0
    for (let y = gy * cell; y < (gy + 1) * cell; y++) for (let x = gx * cell; x < (gx + 1) * cell; x++) {
      const idx = (y * S + x) * 4
      r += data[idx]!; g += data[idx + 1]!; b += data[idx + 2]!; n++
    }
    spatial.push(r / n / 255, g / n / 255, b / n / 255)
  }

  // Gradient orientation (texture/shape): Sobel → 8 bins over a 2×2 block grid.
  const orient = new Array(2 * 2 * 8).fill(0)
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const gx =
      -gray[(y - 1) * S + x - 1]! - 2 * gray[y * S + x - 1]! - gray[(y + 1) * S + x - 1]! +
      gray[(y - 1) * S + x + 1]! + 2 * gray[y * S + x + 1]! + gray[(y + 1) * S + x + 1]!
    const gy =
      -gray[(y - 1) * S + x - 1]! - 2 * gray[(y - 1) * S + x]! - gray[(y - 1) * S + x + 1]! +
      gray[(y + 1) * S + x - 1]! + 2 * gray[(y + 1) * S + x]! + gray[(y + 1) * S + x + 1]!
    const mag = Math.hypot(gx, gy)
    if (mag < 8) continue
    let ang = Math.atan2(gy, gx); if (ang < 0) ang += Math.PI // orientation mod π
    const bin = Math.min(7, Math.floor((ang / Math.PI) * 8))
    const bx = x < S / 2 ? 0 : 1, by = y < S / 2 ? 0 : 1
    orient[(by * 2 + bx) * 8 + bin] += mag
  }

  const vec = l2normalize([...spatial, ...l2normalize(orient)]).map(round3)

  // Separate global colour histogram (4×4×4) for the standalone colour signal.
  const bins = new Array(64).fill(0)
  for (let i = 0; i < data.length; i += 4) {
    bins[(data[i]! >> 6) * 16 + (data[i + 1]! >> 6) * 4 + (data[i + 2]! >> 6)]++
  }
  const color = bins.map((c) => round3(c / (S * S)))

  return { phash, vec, color }
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

/**
 * Turn a product photo into its signature (thumb + descriptors).
 *
 * ⭐ This is the single swap-in point: to use a learned on-device image
 * embedding (MobileCLIP / DINO via onnxruntime-web) instead of / alongside the
 * classical descriptor, compute it here and add it to `vec` — the capsule shape
 * and the scoring below stay the same.
 */
export async function photoSignature(blob: Blob): Promise<PhotoSig> {
  const bmp = await createImageBitmap(blob)
  const { phash, vec, color } = features(bmp)
  bmp.close()
  const thumb = await thumbnail(blob)
  return { thumb, phash, vec, color }
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

/** Cosine similarity of two L2-normalized vectors, clamped to 0..1. */
function cosine(a: number[], b: number[]): number {
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return Math.max(0, Math.min(1, dot))
}

/** Best appearance+colour match of one fresh photo against all origin photos.
 *  Appearance blends the descriptor (cosine) with the pHash (Hamming). */
function bestPhotoMatch(fresh: PhotoSig, origins: PhotoSig[]): { v: number; c: number } {
  let best = { v: 0, c: 0, sum: -1 }
  for (const o of origins) {
    const cos = cosine(fresh.vec, o.vec)
    const ham = hammingSimilarity(fresh.phash, o.phash)
    const v = 0.65 * cos + 0.35 * ham
    const c = histSimilarity(fresh.color, o.color)
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

/* ----------------------------------------------- optional online registry --- */

export interface RegistryInfo {
  registered: boolean
  firstSeen: string | null // TRUSTED server timestamp (upgrades the device clock)
  verifyCount: number // how many times checked (soft double-use signal)
}

/** Register a capsule online (near origin) for a trusted first-seen time.
 *  No-op offline — returns null and the offline flow is unaffected. */
export async function registerCapsule(capsule: TraceCapsule): Promise<RegistryInfo | null> {
  try {
    const res = await fetch('/api/trace/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: capsule.id,
        producer: capsule.context.producer,
        product: capsule.context.product,
        createdAt: capsule.context.capturedAt,
      }),
    })
    if (!res.ok) return null
    const d = (await res.json()) as { firstSeen: string }
    return { registered: true, firstSeen: d.firstSeen, verifyCount: 0 }
  } catch {
    return null
  }
}

/** Check a capsule online: trusted first-seen + verify count. Null offline. */
export async function checkCapsule(id: string): Promise<RegistryInfo | null> {
  try {
    const res = await fetch(`/api/trace/check/${id}`)
    if (!res.ok) return null
    return (await res.json()) as RegistryInfo
  } catch {
    return null
  }
}

/* ----------------------------------------------- shareable provenance page --- */

export interface Attestation {
  name: string
  role?: string
  note?: string
  createdAt: string
}

/** Publish a capsule as a shareable provenance page. Returns the public path. */
export async function publishCapsule(capsule: TraceCapsule): Promise<string | null> {
  try {
    const res = await fetch('/api/trace/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(capsule),
    })
    if (!res.ok) return null
    const d = (await res.json()) as { url: string }
    return d.url
  } catch {
    return null
  }
}

/** Fetch a published provenance capsule by id (for /trace?p=<id>). */
export async function fetchPage(id: string): Promise<TraceCapsule | null> {
  try {
    const res = await fetch(`/api/trace/page/${id}`)
    if (!res.ok) return null
    return (await res.json()) as TraceCapsule
  } catch {
    return null
  }
}

/** A witness (co-op/buyer) adds a confirmation to a capsule. */
export async function addAttestation(
  id: string,
  a: { name: string; role?: string; note?: string },
): Promise<boolean> {
  try {
    const res = await fetch('/api/trace/attest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...a }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchAttestations(id: string): Promise<Attestation[]> {
  try {
    const res = await fetch(`/api/trace/attest/${id}`)
    if (!res.ok) return []
    return ((await res.json()) as { attestations: Attestation[] }).attestations ?? []
  } catch {
    return []
  }
}
