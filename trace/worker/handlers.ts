/**
 * Trace — optional online registry for proof-of-origin capsules.
 *
 * Fully offline verification always works; this backend adds only the two
 * things that genuinely need connectivity:
 *   1. a TRUSTED first-seen timestamp (upgrading the device clock), and
 *   2. DOUBLE-USE transparency (how many times a capsule id has been verified).
 * Plus the opt-in social layer: a published provenance page, witness
 * attestations, and a hash-linked journey chain.
 *
 * Keyless: a capsule id is the SHA-256 of its own contents — the server never
 * signs anything and stores no images or personal data beyond what a maker
 * chose to publish. See ../GUIDE.md and ../SPEC.md.
 *
 * Self-contained: this module depends only on the standard Cloudflare Workers
 * runtime (D1 + R2). Mount it in any worker with:
 *
 *     import { serveTrace } from './trace/worker/handlers'
 *     if (url.pathname.startsWith('/api/trace/')) return serveTrace(url, request, env)
 *
 * where `env` provides `DB` (a D1Database) and `MODELS` (an R2Bucket). Run the
 * schema in ./schema.sql once to create the tables.
 */

import {
  verifyCustody,
  verifyHandoff,
  verifyPartner,
  verifyRelease,
  verifyRevocation,
  type CustodyRecord,
  type HandoffReceipt,
  type HandoffRelease,
  type PartnerRegistration,
  type Revocation,
} from '../core/companion'
import { sha256Hex } from '../../grove/core/grove'

/** The minimal binding surface Trace's registry needs. */
export interface TraceEnv {
  /** D1 database holding trace_capsules + trace_attestations (see schema.sql). */
  DB: D1Database
  /** R2 bucket for published page capsules, under the `trace/pages/` prefix. */
  MODELS: R2Bucket
}

const JSON_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })

const TRACE_ID_RE = /^[0-9a-f]{64}$/
const TRACE_KEY_RE = /^[A-Za-z0-9_-]{80,200}$/ // base64url raw P-256 public key

// Coarsen a coordinate to ~2 decimals (~1 km) for public custody feeds — a
// warehouse/route location shouldn't be exposed to the metre.
const fuzz = (v: number | null): number | null => (v == null ? null : Math.round(v * 100) / 100)

export async function serveTrace(url: URL, request: Request, env: TraceEnv): Promise<Response> {
  const path = url.pathname.slice('/api/trace/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'register' && request.method === 'POST') return await traceRegister(request, env)
    if (path.startsWith('check/') && request.method === 'GET') {
      return await traceCheck(path.slice('check/'.length), env)
    }
    if (path === 'publish' && request.method === 'POST') return await tracePublish(request, env)
    if (path.startsWith('page/') && request.method === 'GET') {
      return await tracePage(path.slice('page/'.length), env)
    }
    if (path === 'attest' && request.method === 'POST') return await traceAttest(request, env)
    if (path.startsWith('attest/') && request.method === 'GET') {
      return await traceAttestList(path.slice('attest/'.length), env)
    }
    if (path.startsWith('chain/') && request.method === 'GET') {
      return await traceChain(path.slice('chain/'.length), env)
    }
    // Companion custody layer (supply-chain actors join the proof).
    if (path === 'custody' && request.method === 'POST') return await traceCustodyPost(request, env)
    if (path.startsWith('custody/') && request.method === 'GET') {
      return await traceCustodyList(path.slice('custody/'.length), env)
    }
    if (path === 'partner' && request.method === 'POST') return await tracePartnerRegister(request, env)
    if (path === 'partner/revoke' && request.method === 'POST') return await tracePartnerRevoke(request, env)
    if (path.startsWith('partner/') && path.endsWith('/revocations') && request.method === 'GET') {
      return await tracePartnerRevocations(path.slice('partner/'.length, -'/revocations'.length), env)
    }
    if (path.startsWith('partner/') && request.method === 'GET') {
      return await tracePartnerGet(path.slice('partner/'.length), env)
    }
    // Two-party handoff (Phase 2): offer (sender) → read → accept (receiver).
    if (path === 'handoff/offer' && request.method === 'POST') return await traceHandoffOffer(request, env)
    if (path.startsWith('handoff/')) {
      const rest = path.slice('handoff/'.length)
      const slash = rest.indexOf('/')
      const code = slash === -1 ? rest : rest.slice(0, slash)
      const action = slash === -1 ? '' : rest.slice(slash + 1)
      if (action === 'accept' && request.method === 'POST') return await traceHandoffAccept(code, request, env)
      if (action === 'status' && request.method === 'GET') return await traceHandoffStatus(code, env)
      if (action === '' && request.method === 'GET') return await traceHandoffGet(code, env)
    }
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|trace_/i.test(msg)
      ? 'trace registry not initialised — run the D1 schema migration (trace/worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Register a capsule at (or near) origin — records a trusted first-seen time.
// Idempotent: re-registering the same id keeps the original first_seen.
async function traceRegister(request: Request, env: TraceEnv): Promise<Response> {
  let body: { id?: string; producer?: string; product?: string; createdAt?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  const id = String(body.id ?? '').toLowerCase()
  if (!TRACE_ID_RE.test(id)) return json({ error: 'bad capsule id' }, 400)
  const now = new Date().toISOString()
  const trim = (v: unknown, n: number) => (v ? String(v).slice(0, n) : null)
  await env.DB.prepare(
    `INSERT INTO trace_capsules (id, producer, product, created_at, first_seen, verify_count)
     VALUES (?,?,?,?,?,0)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(id, trim(body.producer, 80), trim(body.product, 80), trim(body.createdAt, 40), now).run()
  const row = await env.DB.prepare('SELECT first_seen AS firstSeen FROM trace_capsules WHERE id = ?')
    .bind(id).first<{ firstSeen: string }>()
  return json({ registered: true, firstSeen: row?.firstSeen ?? now })
}

// Check a capsule: trusted first-seen time + how many times it's been verified.
// Each check increments the counter (a soft double-use signal — the same proof
// showing up many times, far apart, may mean it was copied onto many items).
async function traceCheck(id: string, env: TraceEnv): Promise<Response> {
  id = id.toLowerCase()
  if (!TRACE_ID_RE.test(id)) return json({ error: 'bad capsule id' }, 400)
  const row = await env.DB.prepare(
    'SELECT first_seen AS firstSeen, verify_count AS verifyCount FROM trace_capsules WHERE id = ?',
  ).bind(id).first<{ firstSeen: string; verifyCount: number }>()
  if (!row) return json({ registered: false, firstSeen: null, verifyCount: 0 })
  const now = new Date().toISOString()
  await env.DB.prepare(
    'UPDATE trace_capsules SET verify_count = verify_count + 1, last_verified = ? WHERE id = ?',
  ).bind(now, id).run()
  return json({ registered: true, firstSeen: row.firstSeen, verifyCount: row.verifyCount + 1 })
}

const TRACE_PAGE_MAX = 2 * 1024 * 1024 // published capsule incl. thumbnails

// Publish a capsule's display data as a shareable provenance page (opt-in — the
// maker chose to make it public). Stored in R2; the page is served read-only.
async function tracePublish(request: Request, env: TraceEnv): Promise<Response> {
  let capsule: {
    id?: string
    prev?: string | null
    event?: { type?: string; step?: number }
    context?: { producer?: string; product?: string; capturedAt?: string }
  }
  const raw = await request.text()
  if (raw.length > TRACE_PAGE_MAX) return json({ error: 'too large' }, 413)
  try {
    capsule = JSON.parse(raw)
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  const id = String(capsule.id ?? '').toLowerCase()
  if (!TRACE_ID_RE.test(id)) return json({ error: 'bad capsule id' }, 400)
  const prev = capsule.prev && TRACE_ID_RE.test(String(capsule.prev).toLowerCase())
    ? String(capsule.prev).toLowerCase() : null

  await env.MODELS.put(`trace/pages/${id}.json`, raw, {
    httpMetadata: { contentType: 'application/json' },
  })
  const now = new Date().toISOString()
  const trim = (v: unknown, n: number) => (v ? String(v).slice(0, n) : null)
  const step = capsule.event?.step && capsule.event.step > 0 ? Math.round(capsule.event.step) : null
  await env.DB.prepare(
    `INSERT INTO trace_capsules
       (id, producer, product, created_at, first_seen, verify_count, published, prev, event_type, step)
     VALUES (?,?,?,?,?,0,1,?,?,?)
     ON CONFLICT(id) DO UPDATE SET published = 1, prev = excluded.prev,
       event_type = excluded.event_type, step = excluded.step`,
  ).bind(id, trim(capsule.context?.producer, 80), trim(capsule.context?.product, 80),
    trim(capsule.context?.capturedAt, 40), now, prev, trim(capsule.event?.type, 20), step).run()
  return json({ published: true, url: `/trace?p=${id}` })
}

// Walk a published journey: back to the root via prev, then forward via
// children, and return each event's stored page capsule in order.
async function traceChain(id: string, env: TraceEnv): Promise<Response> {
  id = id.toLowerCase()
  if (!TRACE_ID_RE.test(id)) return json({ error: 'bad capsule id' }, 400)

  // Back to the root (cap the walk to avoid loops).
  let root = id
  for (let i = 0; i < 50; i++) {
    const row = await env.DB.prepare('SELECT prev FROM trace_capsules WHERE id = ?')
      .bind(root).first<{ prev: string | null }>()
    if (!row || !row.prev) break
    root = row.prev
  }
  // Forward from the root by following children.
  const ids: string[] = []
  let cur: string | null = root
  for (let i = 0; i < 50 && cur; i++) {
    ids.push(cur)
    const child: { id: string } | null = await env.DB
      .prepare('SELECT id FROM trace_capsules WHERE prev = ? ORDER BY step ASC LIMIT 1')
      .bind(cur).first<{ id: string }>()
    cur = child ? child.id : null
  }
  const chain: unknown[] = []
  for (const cid of ids) {
    const obj = await env.MODELS.get(`trace/pages/${cid}.json`)
    if (obj) chain.push(JSON.parse(await obj.text()))
  }
  return new Response(JSON.stringify({ chain }), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' },
  })
}

// Public: fetch a published provenance page (the capsule display JSON).
async function tracePage(id: string, env: TraceEnv): Promise<Response> {
  id = id.toLowerCase()
  if (!TRACE_ID_RE.test(id)) return json({ error: 'bad capsule id' }, 400)
  const obj = await env.MODELS.get(`trace/pages/${id}.json`)
  if (!obj) return json({ error: 'not found' }, 404)
  return new Response(obj.body, {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=60' },
  })
}

// A witness (co-op / buyer) adds a confirmation to a capsule — turns a
// self-claim into a witnessed one. Server-timestamped; shown on the page.
async function traceAttest(request: Request, env: TraceEnv): Promise<Response> {
  let body: { id?: string; name?: string; role?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  const id = String(body.id ?? '').toLowerCase()
  const name = String(body.name ?? '').trim()
  if (!TRACE_ID_RE.test(id)) return json({ error: 'bad capsule id' }, 400)
  if (!name || name.length > 80) return json({ error: 'name required' }, 400)
  const trim = (v: unknown, n: number) => (v ? String(v).slice(0, n) : null)
  await env.DB.prepare(
    `INSERT INTO trace_attestations (id, name, role, note, created_at) VALUES (?,?,?,?,?)`,
  ).bind(id, name.slice(0, 80), trim(body.role, 40), trim(body.note, 200), new Date().toISOString()).run()
  return json({ ok: true })
}

async function traceAttestList(id: string, env: TraceEnv): Promise<Response> {
  id = id.toLowerCase()
  if (!TRACE_ID_RE.test(id)) return json({ error: 'bad capsule id' }, 400)
  const { results } = await env.DB.prepare(
    `SELECT name, role, note, created_at AS createdAt FROM trace_attestations
      WHERE id = ? ORDER BY created_at ASC LIMIT 50`,
  ).bind(id).all()
  return new Response(JSON.stringify({ attestations: results ?? [] }), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' },
  })
}

/* --------------------------------------------------- companion custody --- */

// A supply-chain actor (delivery/warehouse/exporter) adds a device-SIGNED
// custody event to a product capsule. Verify-on-ingest: the actor signature must
// be valid, and any attached delegation must be valid + bound to the actor —
// otherwise it's rejected (a broken company claim is worse than none). A record
// with no delegation is a valid "self-claim". Idempotent on the record hash.
async function traceCustodyPost(request: Request, env: TraceEnv): Promise<Response> {
  let rec: CustodyRecord
  try {
    rec = (await request.json()) as CustodyRecord
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  if (!rec || rec.kind !== 'trace-custody') return json({ error: 'not a custody record' }, 400)
  const capsule = String(rec.capsule ?? '').toLowerCase()
  if (!TRACE_ID_RE.test(capsule)) return json({ error: 'bad capsule id' }, 400)
  if (!TRACE_KEY_RE.test(String(rec.actor ?? ''))) return json({ error: 'bad actor key' }, 400)

  const now = new Date().toISOString()
  const v = await verifyCustody(rec, now)
  if (!v.sigOk) return json({ error: 'bad signature' }, 400)
  // A delegation was attached but doesn't verify/bind/expired → refuse rather
  // than silently downgrade to self-claimed (the actor intended attribution).
  if (rec.delegation && !v.company) {
    return json({ error: 'invalid delegation', detail: v.delegation }, 400)
  }

  // A valid delegation from a REVOKED staff key drops to self-claimed.
  const company = v.company && (await isRevoked(v.company, rec.actor, env)) ? null : v.company

  const raw = JSON.stringify(rec)
  const id = await sha256Hex(raw)
  const gps = rec.gps && typeof rec.gps === 'object' ? rec.gps : null
  await env.DB.prepare(
    `INSERT INTO trace_custody
       (id, capsule, actor_key, actor_name, role, event_type, company_key,
        lat, lng, claimed_at, note, raw, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(
    id, capsule, rec.actor, String(rec.actorName ?? '').slice(0, 80),
    String(rec.role ?? 'other').slice(0, 20), String(rec.event ?? 'other').slice(0, 20),
    company, gps ? Number(gps.lat) : null, gps ? Number(gps.lng) : null,
    String(rec.at ?? '').slice(0, 40), String(rec.note ?? '').slice(0, 200), raw, now,
  ).run()
  return json({ ok: true, id, company, selfClaimed: !company })
}

// Public: the custody timeline for a capsule, each event resolved to its company
// (name/logo/verified) via the partner registry. GPS coarsened to ~1 km.
async function traceCustodyList(capsule: string, env: TraceEnv): Promise<Response> {
  capsule = capsule.toLowerCase()
  if (!TRACE_ID_RE.test(capsule)) return json({ error: 'bad capsule id' }, 400)
  const { results } = await env.DB.prepare(
    `SELECT id, actor_key AS actorKey, actor_name AS actorName, role, event_type AS event,
            company_key AS companyKey, lat, lng, claimed_at AS claimedAt, note,
            created_at AS createdAt
       FROM trace_custody WHERE capsule = ? ORDER BY created_at ASC LIMIT 200`,
  ).bind(capsule).all()
  const rows = (results ?? []) as Record<string, unknown>[]

  // Resolve the distinct companies once.
  const keys = [...new Set(rows.map((r) => r.companyKey).filter(Boolean) as string[])]
  const partners = new Map<string, { name: string; logo: string | null; region: string | null; verified: boolean }>()
  for (const k of keys) {
    const p = await env.DB.prepare(
      'SELECT name, logo, region, verified FROM trace_partners WHERE company_key = ?',
    ).bind(k).first<{ name: string; logo: string | null; region: string | null; verified: number }>()
    if (p) partners.set(k, { name: p.name, logo: p.logo, region: p.region, verified: p.verified === 1 })
  }

  const custody = rows.map((o) => ({
    ...o,
    lat: fuzz(o.lat as number | null),
    lng: fuzz(o.lng as number | null),
    company: o.companyKey ? partners.get(o.companyKey as string) ?? null : null,
    selfClaimed: !o.companyKey,
  }))
  return new Response(JSON.stringify({ capsule, custody }), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=15' },
  })
}

// A company registers its ROOT key → public name/logo. The registration is
// signed by the root key, so only the key's owner can claim a name for it.
// `verified` is never set here — an operator flips it after vetting.
async function tracePartnerRegister(request: Request, env: TraceEnv): Promise<Response> {
  let p: PartnerRegistration
  try {
    p = (await request.json()) as PartnerRegistration
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  if (!p || p.kind !== 'trace-partner') return json({ error: 'not a partner registration' }, 400)
  if (!TRACE_KEY_RE.test(String(p.company ?? ''))) return json({ error: 'bad company key' }, 400)
  const name = String(p.name ?? '').trim()
  if (!name || name.length > 80) return json({ error: 'name required' }, 400)
  if (!(await verifyPartner(p))) return json({ error: 'bad signature' }, 400)

  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO trace_partners (company_key, name, logo, region, verified, raw, created_at, updated_at)
     VALUES (?,?,?,?,0,?,?,?)
     ON CONFLICT(company_key) DO UPDATE SET
       name = excluded.name, logo = excluded.logo, region = excluded.region,
       raw = excluded.raw, updated_at = excluded.updated_at`,
  ).bind(
    p.company, name.slice(0, 80), String(p.logo ?? '').slice(0, 300) || null,
    String(p.region ?? '').slice(0, 40) || null, JSON.stringify(p), now, now,
  ).run()
  return json({ ok: true, company: p.company })
}

/* -------------------------------------------------- two-party handoff --- */

const HANDOFF_TTL_MS = 60 * 60 * 1000 // a pending offer lives 1 hour
const HANDOFF_CODE_RE = /^[A-Z2-9]{4,12}$/
// Crockford-ish alphabet (no 0/O/1/I/L) — easy to read aloud and type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function makeCode(): string {
  const buf = new Uint8Array(6)
  crypto.getRandomValues(buf)
  let s = ''
  for (const b of buf) s += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return s
}

// Sender publishes a signed RELEASE; we verify it and hold it under a fresh code.
async function traceHandoffOffer(request: Request, env: TraceEnv): Promise<Response> {
  let rel: HandoffRelease
  try {
    rel = (await request.json()) as HandoffRelease
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  if (!rel || rel.kind !== 'trace-handoff-release') return json({ error: 'not a release' }, 400)
  const capsule = String(rel.capsule ?? '').toLowerCase()
  if (!TRACE_ID_RE.test(capsule)) return json({ error: 'bad capsule id' }, 400)
  if (!TRACE_KEY_RE.test(String(rel.from ?? ''))) return json({ error: 'bad sender key' }, 400)
  if (!(await verifyRelease(rel))) return json({ error: 'bad signature' }, 400)

  const nowMs = Date.now()
  const expiresAt = new Date(nowMs + HANDOFF_TTL_MS).toISOString()
  const createdAt = new Date(nowMs).toISOString()
  const raw = JSON.stringify(rel)
  for (let i = 0; i < 5; i++) {
    const code = makeCode()
    try {
      await env.DB.prepare(
        `INSERT INTO trace_handoff_pending (code, capsule, from_key, nonce, raw_release, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).bind(code, capsule, rel.from, String(rel.nonce ?? '').slice(0, 80), raw, expiresAt, createdAt).run()
      return json({ ok: true, code, expiresAt })
    } catch (e) {
      // Retry only on a code collision; rethrow anything else (e.g. missing table).
      if (!/unique|constraint/i.test(e instanceof Error ? e.message : String(e))) throw e
    }
  }
  return json({ error: 'could not allocate a code, try again' }, 503)
}

// Receiver reads the pending release for a code (to verify + display the sender).
async function traceHandoffGet(code: string, env: TraceEnv): Promise<Response> {
  if (!HANDOFF_CODE_RE.test(code)) return json({ error: 'bad code' }, 400)
  const row = await env.DB.prepare(
    'SELECT raw_release AS raw, status, expires_at AS expiresAt FROM trace_handoff_pending WHERE code = ?',
  ).bind(code).first<{ raw: string; status: string; expiresAt: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  if (row.status === 'received') return json({ error: 'already received' }, 410)
  if (Date.parse(row.expiresAt) < Date.now()) {
    await env.DB.prepare('DELETE FROM trace_handoff_pending WHERE code = ?').bind(code).run()
    return json({ error: 'expired' }, 410)
  }
  return json({ release: JSON.parse(row.raw) })
}

// Sender polls this to close the proof-of-delivery loop: pending until the
// receiver signs, then 'received' with who confirmed and when.
async function traceHandoffStatus(code: string, env: TraceEnv): Promise<Response> {
  if (!HANDOFF_CODE_RE.test(code)) return json({ error: 'bad code' }, 400)
  const row = await env.DB.prepare(
    'SELECT status, to_name AS receivedBy, completed_at AS at, expires_at AS expiresAt FROM trace_handoff_pending WHERE code = ?',
  ).bind(code).first<{ status: string; receivedBy: string | null; at: string | null; expiresAt: string }>()
  if (!row) return json({ status: 'notfound' })
  if (row.status !== 'received' && Date.parse(row.expiresAt) < Date.now()) return json({ status: 'expired' })
  return json({ status: row.status, receivedBy: row.receivedBy, at: row.at })
}

// Receiver counter-signs a RECEIPT. We verify the pair, write two custody rows
// (sender=handoff, receiver=pickup), and consume the code (single-use).
async function traceHandoffAccept(code: string, request: Request, env: TraceEnv): Promise<Response> {
  if (!HANDOFF_CODE_RE.test(code)) return json({ error: 'bad code' }, 400)
  let rec: HandoffReceipt
  try {
    rec = (await request.json()) as HandoffReceipt
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  if (!rec || rec.kind !== 'trace-handoff-receipt') return json({ error: 'not a receipt' }, 400)
  if (!TRACE_KEY_RE.test(String(rec.to ?? ''))) return json({ error: 'bad receiver key' }, 400)

  const row = await env.DB.prepare(
    'SELECT raw_release AS raw, status, expires_at AS expiresAt FROM trace_handoff_pending WHERE code = ?',
  ).bind(code).first<{ raw: string; status: string; expiresAt: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  if (row.status === 'received') return json({ error: 'already received' }, 409)
  if (Date.parse(row.expiresAt) < Date.now()) {
    await env.DB.prepare('DELETE FROM trace_handoff_pending WHERE code = ?').bind(code).run()
    return json({ error: 'expired' }, 410)
  }
  const rel = JSON.parse(row.raw) as HandoffRelease
  const now = new Date().toISOString()
  const v = await verifyHandoff(rel, rec, now)
  if (!v.releaseSigOk || !v.receiptSigOk) return json({ error: 'bad signature' }, 400)
  if (!v.matched) return json({ error: 'receipt does not match the release' }, 400)
  if ((rel.fromDelegation && !v.fromCompany) || (rec.toDelegation && !v.toCompany)) {
    return json({ error: 'invalid delegation' }, 400)
  }

  // Revoked staff on either side drop to self-claimed.
  const fromCompany = v.fromCompany && (await isRevoked(v.fromCompany, rel.from, env)) ? null : v.fromCompany
  const toCompany = v.toCompany && (await isRevoked(v.toCompany, rec.to, env)) ? null : v.toCompany

  // Persist both sides into the custody timeline (idempotent on the record hash).
  const relRaw = JSON.stringify(rel)
  const recRaw = JSON.stringify(rec)
  const put = `INSERT INTO trace_custody
      (id, capsule, actor_key, actor_name, role, event_type, company_key,
       lat, lng, claimed_at, note, raw, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`
  const rg = rel.gps
  const cg = rec.gps
  await env.DB.prepare(put).bind(
    await sha256Hex(relRaw), rel.capsule, rel.from, String(rel.fromName ?? '').slice(0, 80),
    rel.fromDelegation?.role ?? 'other', 'handoff', fromCompany,
    rg ? Number(rg.lat) : null, rg ? Number(rg.lng) : null, String(rel.at ?? '').slice(0, 40),
    `→ handoff to ${rec.to.slice(0, 8)}…`, relRaw, now,
  ).run()
  const photoNote = rec.photoHash
    ? ` · 📷${typeof rec.match === 'number' ? ` ${rec.match}%` : ''}`
    : ''
  await env.DB.prepare(put).bind(
    await sha256Hex(recRaw), rec.capsule, rec.to, String(rec.toName ?? '').slice(0, 80),
    rec.toDelegation?.role ?? 'other', 'pickup', toCompany,
    cg ? Number(cg.lat) : null, cg ? Number(cg.lng) : null, String(rec.at ?? '').slice(0, 40),
    `↳ received from ${rel.from.slice(0, 8)}…${photoNote}`, recRaw, now,
  ).run()
  // Keep the row as the sender's proof-of-delivery receipt (24h), not deleted.
  const keepUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await env.DB.prepare(
    `UPDATE trace_handoff_pending
        SET status = 'received', to_name = ?, completed_at = ?, expires_at = ?
      WHERE code = ?`,
  ).bind(String(rec.toName ?? '').slice(0, 80) || null, now, keepUntil, code).run()

  return json({ ok: true, capsule: rel.capsule, fromCompany, toCompany })
}

// True if this company has revoked this staff key.
async function isRevoked(company: string, staff: string, env: TraceEnv): Promise<boolean> {
  const r = await env.DB.prepare(
    'SELECT 1 AS x FROM trace_revocations WHERE company_key = ? AND staff_key = ?',
  ).bind(company, staff).first()
  return !!r
}

// Company admin: revoke a staff key (root-signed). Idempotent.
async function tracePartnerRevoke(request: Request, env: TraceEnv): Promise<Response> {
  let rev: Revocation
  try {
    rev = (await request.json()) as Revocation
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  if (!rev || rev.kind !== 'trace-revocation') return json({ error: 'not a revocation' }, 400)
  if (!TRACE_KEY_RE.test(String(rev.company ?? '')) || !TRACE_KEY_RE.test(String(rev.staff ?? ''))) {
    return json({ error: 'bad key' }, 400)
  }
  if (!(await verifyRevocation(rev))) return json({ error: 'bad signature' }, 400)
  await env.DB.prepare(
    `INSERT INTO trace_revocations (company_key, staff_key, at, raw, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(company_key, staff_key) DO UPDATE SET at = excluded.at, raw = excluded.raw`,
  ).bind(rev.company, rev.staff, String(rev.at ?? '').slice(0, 40), JSON.stringify(rev), new Date().toISOString()).run()
  return json({ ok: true })
}

// Public: the list of staff keys a company has revoked (keys + times only).
async function tracePartnerRevocations(key: string, env: TraceEnv): Promise<Response> {
  if (!TRACE_KEY_RE.test(key)) return json({ error: 'bad company key' }, 400)
  const { results } = await env.DB.prepare(
    'SELECT staff_key AS staff, at, created_at AS createdAt FROM trace_revocations WHERE company_key = ? LIMIT 1000',
  ).bind(key).all()
  return new Response(JSON.stringify({ revoked: results ?? [] }), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' },
  })
}

// Public: resolve a company root key → name/logo/verified (for staff/consumers).
async function tracePartnerGet(key: string, env: TraceEnv): Promise<Response> {
  if (!TRACE_KEY_RE.test(key)) return json({ error: 'bad company key' }, 400)
  const p = await env.DB.prepare(
    'SELECT name, logo, region, verified, created_at AS createdAt FROM trace_partners WHERE company_key = ?',
  ).bind(key).first<{ name: string; logo: string | null; region: string | null; verified: number; createdAt: string }>()
  if (!p) return json({ registered: false })
  return new Response(
    JSON.stringify({
      registered: true, company: key, name: p.name, logo: p.logo,
      region: p.region, verified: p.verified === 1, createdAt: p.createdAt,
    }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=60' } },
  )
}
