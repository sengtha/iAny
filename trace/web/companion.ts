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
  verifyDelegation,
  type ActorKey,
  type CustodyEvent,
  type CustodyRecord,
  type CustodyRole,
  type Delegation,
} from '../core/companion'

export type { CustodyEvent, CustodyRole, Delegation }

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
  return signDelegation(
    { company: key.pub, staff: input.staff, staffName: input.staffName, role: input.role, days: input.days, now: new Date().toISOString() },
    key.keyPair,
  )
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
