/**
 * Trace — companion custody layer (supply-chain actors join the proof).
 *
 * Trace's product capsules are **keyless** (id = SHA-256 of contents). This
 * module adds the one thing a supply chain needs that keys *do* solve: a
 * verifiable link from a real-world actor to a company.
 *
 * Three layers, each verifiable **offline** by re-checking ECDSA-P256 signatures
 * (same crypto as grove/core; we reuse its canonical JSON + SHA-256):
 *
 *   1. Staff key      — signs a CustodyRecord over a product capsule id.
 *   2. Delegation      — the COMPANY ROOT key signs {company, staff, role, …},
 *                        proving a staff key acts for the company. Carried with
 *                        the custody event; independent of it (X.509 style).
 *   3. Partner registry — resolves a company root key → name / logo / verified.
 *
 * A verifier walks it: event sig ✓ under staff key → staff key ✓ delegated by
 * company root → company root ✓ in the registry. Self-signed events with **no**
 * delegation are valid too — they just render as "self-claimed". This is the
 * "open now, verify names later" hybrid: attach a delegation later and the same
 * event upgrades to the company with no change to what was signed.
 *
 * Dependency-free (Web Crypto only) — runs identically in a browser and a
 * Cloudflare Worker, so the node can re-verify every record it stores.
 */

import { canonicalize, sha256Hex } from '../../grove/core/grove'

/* ------------------------------------------------------------- vocab --- */

/** What a custody event represents along the journey. */
export const CUSTODY_EVENTS = ['pickup', 'in_transit', 'store', 'handoff', 'deliver', 'inspect'] as const
export type CustodyEvent = (typeof CUSTODY_EVENTS)[number]

/** The kind of actor adding the event. */
export const CUSTODY_ROLES = ['carrier', 'warehouse', 'exporter', 'distributor', 'inspector', 'other'] as const
export type CustodyRole = (typeof CUSTODY_ROLES)[number]

/* -------------------------------------------------------- key helpers --- */

const enc = new TextEncoder()

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

/** An ECDSA-P256 keypair plus its public key as a stable, shareable id. */
export interface ActorKey {
  keyPair: CryptoKeyPair
  /** Public key (base64url raw P-256 point) — the actor / company id. */
  pub: string
}

/** Generate a fresh actor (staff) or company-root keypair. */
export async function generateKey(): Promise<ActorKey> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  )) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer)
  return { keyPair, pub: b64url(raw) }
}

async function importVerifyKey(pub: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', unb64url(pub), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
}

// Sign the SHA-256 (hex) of the canonical form — same envelope grove uses, so a
// signature always covers exactly the fields present, order-independent.
async function signDigest(unsigned: unknown, key: CryptoKeyPair): Promise<string> {
  const digest = await sha256Hex(canonicalize(unsigned))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, enc.encode(digest))
  return b64url(new Uint8Array(sig))
}
async function verifyDigest(unsigned: unknown, sig: string, pub: string): Promise<boolean> {
  try {
    const digest = await sha256Hex(canonicalize(unsigned))
    const key = await importVerifyKey(pub)
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64url(sig), enc.encode(digest))
  } catch {
    return false
  }
}

/* --------------------------------------------------------- delegation --- */

/** A company root's signed statement that a staff key may act for it. */
export interface Delegation {
  v: 1
  kind: 'trace-delegation'
  /** Company root public key (the registered partner id). */
  company: string
  /** Staff device public key this delegation authorizes. */
  staff: string
  staffName: string
  role: CustodyRole
  issuedAt: string
  /** ISO time after which the delegation is no longer valid. */
  expiresAt: string
  /** Company root signature over the canonical fields above. */
  sig: string
}

export interface DelegationInput {
  company: string
  staff: string
  staffName: string
  role: CustodyRole
  /** Validity window in days from now (default 365). */
  days?: number
  /** ISO 'now' (pass explicitly so signing is deterministic/testable). */
  now: string
}

/** Company admin: mint a delegation for a staff key (signs with the ROOT key). */
export async function signDelegation(input: DelegationInput, rootKey: CryptoKeyPair): Promise<Delegation> {
  const issued = new Date(input.now)
  const expires = new Date(issued.getTime() + (input.days ?? 365) * 86400_000)
  const unsigned = {
    v: 1 as const,
    kind: 'trace-delegation' as const,
    company: input.company,
    staff: input.staff,
    staffName: input.staffName.slice(0, 80),
    role: input.role,
    issuedAt: issued.toISOString(),
    expiresAt: expires.toISOString(),
  }
  return { ...unsigned, sig: await signDigest(unsigned, rootKey) }
}

export interface DelegationVerdict {
  ok: boolean
  sigOk: boolean
  expired: boolean
}

/** Verify a delegation: signed by its own `company` root key and not expired. */
export async function verifyDelegation(d: Delegation, now: string): Promise<DelegationVerdict> {
  const { sig, ...unsigned } = d
  const sigOk = d?.kind === 'trace-delegation' && (await verifyDigest(unsigned, sig, d.company))
  const expired = !(Date.parse(d?.expiresAt) > Date.parse(now))
  return { ok: sigOk && !expired, sigOk, expired }
}

/* ---------------------------------------------------------- custody --- */

export interface Gps { lat: number; lng: number; acc?: number }

/** A staff-signed custody event attached to a product capsule. */
export interface CustodyRecord {
  v: 1
  kind: 'trace-custody'
  /** The product capsule id (64 hex) this event is about. */
  capsule: string
  /** Signer (staff device) public key. */
  actor: string
  actorName: string
  role: CustodyRole
  event: CustodyEvent
  gps: Gps | null
  /** Signer-claimed time (untrusted; the node adds a trusted first-seen). */
  at: string
  note: string
  /** Actor signature over everything above (NOT including the delegation). */
  sig: string
  /** Optional membership proof. Absent = "self-claimed"; present = company. */
  delegation?: Delegation | null
}

export interface CustodyInput {
  capsule: string
  actor: string
  actorName: string
  role: CustodyRole
  event: CustodyEvent
  gps?: Gps | null
  at: string
  note?: string
}

/** Staff: build + sign a custody event. Attach a delegation separately (below). */
export async function signCustody(input: CustodyInput, actorKey: CryptoKeyPair): Promise<CustodyRecord> {
  const unsigned = {
    v: 1 as const,
    kind: 'trace-custody' as const,
    capsule: input.capsule.toLowerCase(),
    actor: input.actor,
    actorName: input.actorName.slice(0, 80),
    role: input.role,
    event: input.event,
    gps: input.gps ?? null,
    at: input.at,
    note: (input.note ?? '').slice(0, 200),
  }
  return { ...unsigned, sig: await signDigest(unsigned, actorKey) }
}

export interface CustodyVerdict {
  /** Actor signature valid over the event. */
  sigOk: boolean
  /** Delegation result, or null when the event is self-claimed (no delegation). */
  delegation: DelegationVerdict | null
  /** The delegation authorizes exactly this actor (staff === actor). */
  staffBound: boolean
  /** Resolved company root key when the delegation is valid + bound, else null. */
  company: string | null
  /** Overall: the event is authentic (self-claimed still counts as ok=true). */
  ok: boolean
}

/**
 * Verify a custody event. `sigOk` is the floor (a real actor signed it). If a
 * delegation is attached it must be valid, unexpired, and bound to this actor to
 * yield a `company`; otherwise the event is a valid **self-claim** (company: null).
 */
export async function verifyCustody(rec: CustodyRecord, now: string): Promise<CustodyVerdict> {
  const { sig, delegation, ...unsigned } = rec
  const sigOk = rec?.kind === 'trace-custody' && (await verifyDigest(unsigned, sig, rec.actor))
  let del: DelegationVerdict | null = null
  let staffBound = false
  let company: string | null = null
  if (delegation) {
    del = await verifyDelegation(delegation, now)
    staffBound = delegation.staff === rec.actor
    if (del.ok && staffBound) company = delegation.company
  }
  // Self-claimed (no delegation) is still authentic; a *broken* delegation is not.
  const delegationOk = !delegation || (del !== null && del.ok && staffBound)
  return { sigOk, delegation: del, staffBound, company, ok: sigOk && delegationOk }
}

/* ---------------------------------------------------- partner registry --- */

/** A company registering its root key → public name / logo (self-asserted). */
export interface PartnerRegistration {
  v: 1
  kind: 'trace-partner'
  /** Company root public key (must match the signature). */
  company: string
  name: string
  logo: string
  region: string
  at: string
  /** Signature by the company root key — proves key ownership. */
  sig: string
}

export interface PartnerInput {
  company: string
  name: string
  logo?: string
  region?: string
  at: string
}

/** Company: sign a registration so only the key's owner can claim its name. */
export async function signPartner(input: PartnerInput, rootKey: CryptoKeyPair): Promise<PartnerRegistration> {
  const unsigned = {
    v: 1 as const,
    kind: 'trace-partner' as const,
    company: input.company,
    name: input.name.slice(0, 80),
    logo: (input.logo ?? '').slice(0, 300),
    region: (input.region ?? '').slice(0, 40),
    at: input.at,
  }
  return { ...unsigned, sig: await signDigest(unsigned, rootKey) }
}

/** Verify a registration is self-signed by the company root key it claims. */
export async function verifyPartner(p: PartnerRegistration): Promise<boolean> {
  const { sig, ...unsigned } = p
  return p?.kind === 'trace-partner' && (await verifyDigest(unsigned, sig, p.company))
}
