/**
 * Grove — an open, decentralized network for **verifiable garden/tree
 * observations**. The user's phone is the source of truth: it estimates a plant's
 * carbon from a photo + measurement on-device, then **signs** the observation with
 * a device key. Anyone — a startup dashboard, a community, CamboVerse — can verify
 * and aggregate the record with no central server and no trust in one operator.
 *
 * Design (see SPEC.md):
 *  • Content-addressed: `id` = SHA-256 of the canonical observation (tamper-evident).
 *  • Signed: `sig` = the device's ECDSA-P256 signature over `id` (authenticity —
 *    proves *which device* said it, without a directory; the pubkey is embedded).
 *  • Attestable: other devices can co-sign an observation ("I visited, confirmed"),
 *    which is the decentralized trust layer — signatures prove *who said*, not
 *    *what's true* (the oracle problem has no pure-crypto fix; see SPEC §6).
 *
 * Honest scope: `co2Kg` is an **estimate** from published allometry, never a
 * certified credit. This library is dependency-free and runs the same in a browser
 * and in Node (Web Crypto + standard JS only).
 */

/* --------------------------------------------------------------- types --- */

/** How the plant was measured, driving the carbon estimate. */
export interface Measure {
  method: 'dbh_height' | 'dbh' | 'height' | 'manual'
  /** Diameter at breast height, cm (1.3 m up the trunk). */
  dbh_cm?: number
  /** Total height, m. */
  height_m?: number
  /** Wood density g/cm³ (species-specific; defaults to 0.6 if unknown). */
  woodDensity?: number
  /** For method 'manual': a directly supplied above-ground biomass, kg. */
  biomassKg?: number
}

/** A single signed observation of one plant (or a uniform group of them). */
export interface GardenObservation {
  v: 1
  kind: 'observation'
  /** WHO — the signing device's public key (base64url raw P-256 point). The id. */
  device: string
  /** WHERE (logical) — a stable plot id grouping a garden's observations over time. */
  plot: string
  /** WHAT — species id/name (from /species ID or typed), e.g. "mango". */
  species: string
  /** How many identical plants this record represents. */
  count: number
  measure: Measure
  /** Estimated above-ground biomass, kg (total, i.e. per-plant × count). */
  biomassKg: number
  /** Estimated CO₂e sequestered, kg (biomass × 0.47 carbon × 3.67 CO₂/C). */
  co2Kg: number
  /** WHERE (physical) — optional GPS claim. */
  gps: { lat: number; lng: number; acc: number } | null
  /** WHEN — device clock, an unverified claim. ISO-8601. */
  observedAt: string
  /** SHA-256 (hex) of the photo — ties the record to a real image (Trace-style). */
  photoHash: string
  /** Previous observation id for this plot — links a growth chain (tamper-evident). */
  prev: string | null
  note: string
  /** Content id = SHA-256 of the canonical observation (all fields above). */
  id: string
  /** Device signature over `id`, base64url. */
  sig: string
}

/** A third-party co-signature on an observation — the decentralized trust layer. */
export interface Attestation {
  v: 1
  kind: 'attestation'
  /** The observation being attested. */
  ref: string
  /** Attester device public key (base64url raw P-256). */
  device: string
  verdict: 'confirm' | 'dispute'
  note: string
  at: string
  id: string
  sig: string
}

export interface VerifyResult {
  ok: boolean
  /** The content hash recomputes to the stored id (not tampered). */
  idOk: boolean
  /** The signature is valid for the embedded device key over the id. */
  sigOk: boolean
}

/* ----------------------------------------------------------- constants --- */

/** Carbon fraction of dry biomass (IPCC default). */
export const CARBON_FRACTION = 0.47
/** CO₂ per unit carbon (44/12). */
export const CO2_PER_C = 3.6667
/** Fallback wood density g/cm³ when species is unknown. */
export const DEFAULT_WOOD_DENSITY = 0.6
/** A few common Cambodian garden species (g/cm³). Extend freely. */
export const WOOD_DENSITY: Record<string, number> = {
  mango: 0.52,
  jackfruit: 0.6,
  coconut: 0.6, // palms differ; treated approximately
  teak: 0.55,
  tamarind: 0.8,
  longan: 0.62,
  guava: 0.66,
  // herbaceous (banana, papaya) → tiny woody biomass; see estimateCarbon()
}

/* -------------------------------------------------------- canonical + hash --- */

const enc = new TextEncoder()

/** Deterministic JSON: object keys sorted recursively, so ANY implementation
 *  produces byte-identical bytes → the same id + verifiable signature. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(o[k])).join(',') + '}'
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const buf = typeof input === 'string' ? enc.encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

/* ---------------------------------------------------------------- carbon --- */

/**
 * Estimate above-ground biomass + CO₂ from a measurement, using the Chave et al.
 * (2014) pantropical allometry: AGB = 0.0673·(ρ·D²·H)^0.976 (kg). Deliberately
 * **conservative** — woody plants only. Herbaceous plants (banana/papaya/veg) store
 * negligible durable carbon, so they return ~0 rather than being over-credited.
 */
export function estimateCarbon(measure: Measure, species = ''): { biomassKg: number; co2Kg: number } {
  const rho = measure.woodDensity ?? WOOD_DENSITY[species.toLowerCase()] ?? DEFAULT_WOOD_DENSITY
  let agb = 0
  if (measure.method === 'manual' && measure.biomassKg != null) {
    agb = Math.max(0, measure.biomassKg)
  } else if (measure.dbh_cm != null && measure.dbh_cm > 0) {
    const d = measure.dbh_cm
    const h = measure.height_m ?? estHeightFromDbh(d) // fall back to a height–diameter guess
    agb = 0.0673 * Math.pow(rho * d * d * h, 0.976)
  } else if (measure.height_m != null && measure.height_m > 0) {
    // Height-only: crude — assume a slender stem; strongly under-estimates on purpose.
    const d = measure.height_m * 2 // ~2 cm DBH per metre, conservative
    agb = 0.0673 * Math.pow(rho * d * d * measure.height_m, 0.976) * 0.5
  }
  const biomassKg = round(agb, 2)
  const co2Kg = round(agb * CARBON_FRACTION * CO2_PER_C, 2)
  return { biomassKg, co2Kg }
}

/** Rough height from DBH when height wasn't measured (H ≈ 3·D^0.5, capped). */
function estHeightFromDbh(dbh_cm: number): number {
  return Math.min(30, 3 * Math.sqrt(dbh_cm))
}

function round(n: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/* ------------------------------------------------------------- identity --- */

export interface DeviceKey {
  keyPair: CryptoKeyPair
  /** Public key as the device id (base64url raw P-256 point). */
  device: string
}

/** Generate a device keypair. Persist `keyPair.privateKey` on-device (the web
 *  layer handles storage/backup); publish `device` freely. */
export async function generateDeviceKey(): Promise<DeviceKey> {
  // Cast: @cloudflare/workers-types types generateKey's return as a
  // CryptoKeyPair | CryptoKey union (the DOM lib narrows by algorithm). For an
  // asymmetric algorithm it is always a CryptoKeyPair.
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer,
  )
  return { keyPair, device: b64url(raw) }
}

async function importVerifyKey(device: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    unb64url(device),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  )
}

/* ---------------------------------------------------- build / sign / verify --- */

export interface ObservationInput {
  device: string
  plot: string
  species: string
  count: number
  measure: Measure
  gps?: { lat: number; lng: number; acc: number } | null
  observedAt: string
  photoHash: string
  prev?: string | null
  note?: string
}

/** Build the unsigned observation (computes carbon; no id/sig yet). */
export function buildObservation(input: ObservationInput): Omit<GardenObservation, 'id' | 'sig'> {
  const count = Math.max(1, Math.round(input.count))
  const per = estimateCarbon(input.measure, input.species)
  return {
    v: 1,
    kind: 'observation',
    device: input.device,
    plot: input.plot,
    species: input.species,
    count,
    measure: input.measure,
    biomassKg: round(per.biomassKg * count, 2),
    co2Kg: round(per.co2Kg * count, 2),
    gps: input.gps ?? null,
    observedAt: input.observedAt,
    photoHash: input.photoHash,
    prev: input.prev ?? null,
    note: input.note ?? '',
  }
}

/** Sign an unsigned observation with a device keypair → a complete record. */
export async function signObservation(
  unsigned: Omit<GardenObservation, 'id' | 'sig'>,
  key: CryptoKeyPair,
): Promise<GardenObservation> {
  const id = await sha256Hex(canonicalize(unsigned))
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key.privateKey,
    enc.encode(id),
  )
  return { ...unsigned, id, sig: b64url(new Uint8Array(sigBuf)) }
}

/** Verify an observation: content hash matches, and the device signature is valid. */
export async function verifyObservation(obs: GardenObservation): Promise<VerifyResult> {
  const { id, sig, ...unsigned } = obs
  let idOk = false
  let sigOk = false
  try {
    idOk = (await sha256Hex(canonicalize(unsigned))) === id
    const pub = await importVerifyKey(obs.device)
    sigOk = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      unb64url(sig),
      enc.encode(id),
    )
  } catch {
    /* malformed → not ok */
  }
  return { ok: idOk && sigOk, idOk, sigOk }
}

/* ---------------------------------------------------------- attestations --- */

export async function signAttestation(
  input: { ref: string; device: string; verdict: 'confirm' | 'dispute'; note?: string; at: string },
  key: CryptoKeyPair,
): Promise<Attestation> {
  const unsigned = {
    v: 1 as const,
    kind: 'attestation' as const,
    ref: input.ref,
    device: input.device,
    verdict: input.verdict,
    note: input.note ?? '',
    at: input.at,
  }
  const id = await sha256Hex(canonicalize(unsigned))
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, enc.encode(id))
  return { ...unsigned, id, sig: b64url(new Uint8Array(sigBuf)) }
}

export async function verifyAttestation(a: Attestation): Promise<VerifyResult> {
  const { id, sig, ...unsigned } = a
  let idOk = false
  let sigOk = false
  try {
    idOk = (await sha256Hex(canonicalize(unsigned))) === id
    const pub = await importVerifyKey(a.device)
    sigOk = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(sig), enc.encode(id))
  } catch {
    /* malformed */
  }
  return { ok: idOk && sigOk, idOk, sigOk }
}

/**
 * A transparent, heuristic trust score (0–100) for an observation given the
 * attestations collected for it. NOT authority — just a legible signal:
 * base credibility + confirmations from *distinct* devices − disputes. The verifier
 * decides the threshold. (Real anti-Sybil needs reputation/known verifiers — SPEC §6.)
 */
export function trustScore(obs: GardenObservation, attestations: Attestation[]): number {
  let score = 20 // a valid self-signed observation, unattested
  if (obs.gps) score += 10
  if (obs.photoHash) score += 10
  if (obs.prev) score += 5 // part of a growth chain
  const distinct = new Map<string, 'confirm' | 'dispute'>()
  for (const a of attestations) {
    if (a.ref !== obs.id || a.device === obs.device) continue // ignore self-attest
    distinct.set(a.device, a.verdict) // last verdict per attester wins
  }
  for (const v of distinct.values()) score += v === 'confirm' ? 18 : -25
  return Math.max(0, Math.min(100, Math.round(score)))
}
