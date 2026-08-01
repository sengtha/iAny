/**
 * Trace companion — web client for the custody layer.
 *
 * Holds the on-device keys (a **staff** key everyone has, and a **company root**
 * key only an admin device holds), persisted as JWK in localStorage, and wraps
 * the node calls: register a company, mint a staff delegation, import one, and
 * post signed custody events. All signing is `../core/companion` (Web Crypto);
 * the node re-verifies everything, so this layer is pure convenience.
 */

import {
  generateKey,
  signCustody,
  signDelegation,
  signPartner,
  signRelease,
  signReceipt,
  signRevocation,
  verifyDelegation,
  type ActorKey,
  type CustodyEvent,
  type CustodyRecord,
  type CustodyRole,
  type Delegation,
  type HandoffRelease,
} from '../core/companion'

export type { CustodyEvent, CustodyRole, Delegation, HandoffRelease }

const NODE = '/api/trace'
const STAFF_SLOT = 'iany.trace.staffKey'
const COMPANY_SLOT = 'iany.trace.companyKey'
const DELEGATION_SLOT = 'iany.trace.delegation'

/* ------------------------------------------------------- key storage --- */

function unb64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

interface StoredKey { jwk: JsonWebKey; pub: string }

async function persist(slot: string, k: ActorKey): Promise<void> {
  const jwk = await crypto.subtle.exportKey('jwk', k.keyPair.privateKey)
  localStorage.setItem(slot, JSON.stringify({ jwk, pub: k.pub } satisfies StoredKey))
}
async function restore(slot: string): Promise<ActorKey | null> {
  const raw = localStorage.getItem(slot)
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as StoredKey
    const privateKey = await crypto.subtle.importKey(
      'jwk', s.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'],
    )
    const publicKey = await crypto.subtle.importKey(
      'raw', unb64url(s.pub), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'],
    )
    return { keyPair: { privateKey, publicKey }, pub: s.pub }
  } catch {
    return null
  }
}
async function getOrCreate(slot: string): Promise<ActorKey> {
  const existing = await restore(slot)
  if (existing) return existing
  const fresh = await generateKey()
  await persist(slot, fresh)
  return fresh
}

/** This device's staff key (created on first use). Its `pub` is the actor id. */
export const getStaffKey = (): Promise<ActorKey> => getOrCreate(STAFF_SLOT)
/** This device's company ROOT key — only an admin device should create one. */
export const getCompanyKey = (): Promise<ActorKey> => getOrCreate(COMPANY_SLOT)

/** Public key of a stored slot without creating one (for display). */
export function peekPub(which: 'staff' | 'company'): string | null {
  const raw = localStorage.getItem(which === 'staff' ? STAFF_SLOT : COMPANY_SLOT)
  if (!raw) return null
  try {
    return (JSON.parse(raw) as StoredKey).pub
  } catch {
    return null
  }
}

export function loadDelegation(): Delegation | null {
  const raw = localStorage.getItem(DELEGATION_SLOT)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Delegation
  } catch {
    return null
  }
}
function saveDelegation(d: Delegation): void {
  localStorage.setItem(DELEGATION_SLOT, JSON.stringify(d))
}
export function clearDelegation(): void {
  localStorage.removeItem(DELEGATION_SLOT)
}

/* ------------------------------------------------------- node calls --- */

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${NODE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `request failed (${res.status})`)
  return (await res.json()) as Record<string, unknown>
}

/** Company admin: register/refresh this company root key's public name + logo. */
export async function registerCompany(input: {
  name: string; logo?: string; region?: string
}): Promise<string> {
  const key = await getCompanyKey()
  const reg = await signPartner(
    { company: key.pub, name: input.name, logo: input.logo, region: input.region, at: new Date().toISOString() },
    key.keyPair,
  )
  await postJson('/partner', reg)
  return key.pub
}

/** Company admin: mint a delegation authorizing a staff key to act for us. */
export async function mintDelegation(input: {
  staff: string; staffName: string; role: CustodyRole; days?: number
}): Promise<Delegation> {
  const key = await getCompanyKey()
  const d = await signDelegation(
    { company: key.pub, staff: input.staff, staffName: input.staffName, role: input.role, days: input.days, now: new Date().toISOString() },
    key.keyPair,
  )
  recordEnrollment(d) // remember on the admin device for the roster view
  return d
}

/* ------------------------------------------------------ roster (local) --- */

const ROSTER_SLOT = 'iany.trace.roster'

/** An enrolled staff member, remembered on the admin device that minted them. */
export interface RosterEntry {
  staff: string
  staffName: string
  role: CustodyRole
  issuedAt: string
  expiresAt: string
}

export function loadRoster(): RosterEntry[] {
  try {
    return JSON.parse(localStorage.getItem(ROSTER_SLOT) ?? '[]') as RosterEntry[]
  } catch {
    return []
  }
}
function recordEnrollment(d: Delegation): void {
  const roster = loadRoster().filter((e) => e.staff !== d.staff)
  roster.push({ staff: d.staff, staffName: d.staffName, role: d.role, issuedAt: d.issuedAt, expiresAt: d.expiresAt })
  localStorage.setItem(ROSTER_SLOT, JSON.stringify(roster))
}

/** Company admin: revoke a staff key (root-signed) so the node stops attributing. */
export async function revokeStaff(staffKey: string): Promise<void> {
  const key = await getCompanyKey()
  const rev = await signRevocation({ company: key.pub, staff: staffKey, at: new Date().toISOString() }, key.keyPair)
  await postJson('/partner/revoke', rev)
}

/** The set of staff keys this company has revoked (for the roster's status). */
export async function fetchRevocations(companyKey: string): Promise<Set<string>> {
  try {
    const res = await fetch(`${NODE}/partner/${companyKey}/revocations`)
    if (!res.ok) return new Set()
    const d = (await res.json()) as { revoked?: { staff: string }[] }
    return new Set((d.revoked ?? []).map((r) => r.staff))
  } catch {
    return new Set()
  }
}

/** Staff: import a delegation minted for THIS device; stored if valid + bound. */
export async function importDelegation(d: Delegation): Promise<{
  ok: boolean; company: string; expired: boolean; bound: boolean
}> {
  const staff = await getStaffKey()
  const v = await verifyDelegation(d, new Date().toISOString())
  const bound = d?.staff === staff.pub
  if (v.ok && bound) saveDelegation(d)
  return { ok: v.ok && bound, company: d?.company ?? '', expired: v.expired, bound }
}

/** Staff: sign + post a custody event (attaching our delegation if we have one). */
export async function addCustody(input: {
  capsule: string; actorName: string; role: CustodyRole; event: CustodyEvent
  gps?: { lat: number; lng: number; acc?: number } | null; note?: string
}): Promise<{ company: string | null; selfClaimed: boolean }> {
  const staff = await getStaffKey()
  const signed = await signCustody(
    { capsule: input.capsule, actor: staff.pub, actorName: input.actorName, role: input.role, event: input.event, gps: input.gps ?? null, at: new Date().toISOString(), note: input.note },
    staff.keyPair,
  )
  const delegation = loadDelegation()
  const rec: CustodyRecord = delegation ? { ...signed, delegation } : signed
  const out = await postJson('/custody', rec)
  return { company: (out.company as string) ?? null, selfClaimed: Boolean(out.selfClaimed) }
}

/* --------------------------------------------------- two-party handoff --- */

function makeNonce(): string {
  const b = new Uint8Array(12)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Sender: sign a release and publish it under a short handoff code. */
export async function startHandoff(input: {
  capsule: string; actorName?: string; gps?: { lat: number; lng: number; acc?: number } | null
}): Promise<{ code: string; expiresAt: string }> {
  const staff = await getStaffKey()
  const del = loadDelegation()
  const rel = await signRelease(
    {
      capsule: input.capsule.toLowerCase(), from: staff.pub, at: new Date().toISOString(),
      gps: input.gps ?? null, nonce: makeNonce(),
      fromName: input.actorName || del?.staffName, fromDelegation: del,
    },
    staff.keyPair,
  )
  const out = await postJson('/handoff/offer', rel)
  return { code: out.code as string, expiresAt: out.expiresAt as string }
}

/** Receiver: fetch the pending release for a code (to verify + display sender). */
export async function fetchHandoffOffer(
  code: string,
): Promise<{ ok: true; release: HandoffRelease } | { ok: false; error: 'expired' | 'notfound' }> {
  try {
    const res = await fetch(`${NODE}/handoff/${code}`)
    if (res.ok) return { ok: true, release: ((await res.json()) as { release: HandoffRelease }).release }
    return { ok: false, error: res.status === 410 ? 'expired' : 'notfound' }
  } catch {
    return { ok: false, error: 'notfound' }
  }
}

export interface HandoffStatus {
  status: 'pending' | 'received' | 'expired' | 'notfound'
  receivedBy?: string | null
  at?: string | null
}

/** Sender: poll whether the handoff has been received yet (proof of delivery). */
export async function fetchHandoffStatus(code: string): Promise<HandoffStatus> {
  try {
    const res = await fetch(`${NODE}/handoff/${code}/status`)
    if (!res.ok) return { status: 'notfound' }
    return (await res.json()) as HandoffStatus
  } catch {
    return { status: 'notfound' }
  }
}

/** Receiver: counter-sign the release and complete the handoff (single-use code). */
export async function acceptHandoff(
  code: string, release: HandoffRelease,
  input: { actorName?: string; gps?: { lat: number; lng: number; acc?: number } | null },
): Promise<{ fromCompany: string | null; toCompany: string | null }> {
  const staff = await getStaffKey()
  const del = loadDelegation()
  const receipt = await signReceipt(
    {
      capsule: release.capsule, from: release.from, to: staff.pub, at: new Date().toISOString(),
      gps: input.gps ?? null, nonce: release.nonce,
      toName: input.actorName || del?.staffName, toDelegation: del,
    },
    staff.keyPair,
  )
  const out = await postJson(`/handoff/${code}/accept`, receipt)
  return { fromCompany: (out.fromCompany as string) ?? null, toCompany: (out.toCompany as string) ?? null }
}

/* -------------------------------------------------------- read side --- */

export interface CustodyItem {
  id: string
  actorKey: string
  actorName: string | null
  role: CustodyRole
  event: CustodyEvent
  companyKey: string | null
  lat: number | null
  lng: number | null
  claimedAt: string | null
  note: string | null
  createdAt: string
  selfClaimed: boolean
  company: { name: string; logo: string | null; region: string | null; verified: boolean } | null
}

/** Resolve a company root key → its public name/verified (or null if unknown). */
export async function fetchPartner(companyKey: string): Promise<{ name: string; verified: boolean } | null> {
  try {
    const res = await fetch(`${NODE}/partner/${companyKey}`)
    if (!res.ok) return null
    const d = (await res.json()) as { registered?: boolean; name?: string; verified?: boolean }
    return d.registered ? { name: d.name ?? '', verified: Boolean(d.verified) } : null
  } catch {
    return null
  }
}

/** Public: the custody timeline for a capsule (companies resolved, GPS coarsened). */
export async function fetchCustody(capsule: string): Promise<CustodyItem[]> {
  try {
    const res = await fetch(`${NODE}/custody/${capsule}`)
    if (!res.ok) return []
    const data = (await res.json()) as { custody?: CustodyItem[] }
    return data.custody ?? []
  } catch {
    return []
  }
}
