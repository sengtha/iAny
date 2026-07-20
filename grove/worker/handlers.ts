/**
 * Grove — the reference **node** (federated verify-on-ingest + public feeds).
 *
 * A Grove node is deliberately thin and trustless: it accepts device-signed
 * observations, **re-verifies every one** (content hash + ECDSA-P256 signature)
 * before storing, and serves read-only aggregate feeds anyone can consume — a
 * startup dashboard, a community, CamboVerse. Nothing here mints authority: the
 * node stores the exact signed bytes (`raw`) so any consumer can re-verify
 * independently and, if it likes, federate the record onward. The user's phone
 * remains the source of truth; a node is just a convenient, replaceable mirror.
 *
 * Self-contained: depends only on the Cloudflare Workers runtime (D1) plus the
 * dependency-free `../core/grove` crypto (Web Crypto works in Workers). Mount it:
 *
 *     import { handleGrove } from './grove/worker/handlers'
 *     if (url.pathname.startsWith('/api/grove/')) return handleGrove(url, request, env)
 *
 * where `env.DB` is a D1Database. Run ./schema.sql once to create the tables.
 * See ../SPEC.md (protocol) and ../BRIDGE.md (the CamboVerse read contract).
 */

import {
  verifyObservation,
  verifyAttestation,
  trustScore,
  type GardenObservation,
  type Attestation,
} from '../core/grove'

/** The minimal binding surface a Grove node needs. */
export interface GroveEnv {
  /** D1 database holding grove_observations + grove_attestations (see schema.sql). */
  DB: D1Database
}

const JSON_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })

const OBS_ID_RE = /^[0-9a-f]{64}$/
const DEVICE_RE = /^[A-Za-z0-9_-]{40,120}$/
const PLOT_RE = /^[\w -]{1,40}$/
// A single submit can't be unbounded — cap the bundle so one POST can't flood.
const MAX_BUNDLE = 500
const SUBMIT_MAX_BYTES = 4 * 1024 * 1024

export async function handleGrove(url: URL, request: Request, env: GroveEnv): Promise<Response> {
  const path = url.pathname.slice('/api/grove/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'submit' && request.method === 'POST') return await groveSubmit(request, env)
    if (path === 'attest' && request.method === 'POST') return await groveAttest(request, env)
    if (path === 'stats' && request.method === 'GET') return await groveStats(env)
    if (path === 'feed' && request.method === 'GET') return await groveFeed(url, env)
    if (path.startsWith('plot/') && request.method === 'GET') {
      return await grovePlot(decodeURIComponent(path.slice('plot/'.length)), env)
    }
    if (path.startsWith('observation/') && request.method === 'GET') {
      return await groveObservation(path.slice('observation/'.length), env)
    }
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|grove_/i.test(msg)
      ? 'grove node not initialised — run the D1 schema migration (grove/worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

/**
 * Submit one signed observation or a `{ observations: [...] }` bundle. Every
 * record is **re-verified** here (this is the whole point of a node) — only
 * cryptographically valid records are stored, and storing is idempotent on the
 * content id. The exact signed JSON is kept in `raw` for re-verification /
 * federation. Returns per-record acceptance so a client can retry the rest.
 */
async function groveSubmit(request: Request, env: GroveEnv): Promise<Response> {
  const rawBody = await request.text()
  if (rawBody.length > SUBMIT_MAX_BYTES) return json({ error: 'too large' }, 413)
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  const list = extractObservations(parsed)
  if (!list.length) return json({ error: 'no observations' }, 400)
  if (list.length > MAX_BUNDLE) return json({ error: `too many (max ${MAX_BUNDLE})` }, 413)

  const accepted: string[] = []
  const rejected: { id?: string; reason: string }[] = []
  for (const obs of list) {
    const res = await ingestObservation(obs, env)
    if (res.ok) accepted.push(res.id)
    else rejected.push({ id: obs?.id, reason: res.reason })
  }
  return json({ accepted: accepted.length, rejected: rejected.length, ids: accepted, errors: rejected })
}

function extractObservations(parsed: unknown): GardenObservation[] {
  if (Array.isArray(parsed)) return parsed as GardenObservation[]
  if (parsed && typeof parsed === 'object') {
    const o = parsed as { observations?: unknown; kind?: string }
    if (Array.isArray(o.observations)) return o.observations as GardenObservation[]
    if (o.kind === 'observation') return [parsed as GardenObservation]
  }
  return []
}

// Verify + store a single observation. The gate that makes a node trustless.
async function ingestObservation(
  obs: GardenObservation,
  env: GroveEnv,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!obs || typeof obs !== 'object') return { ok: false, reason: 'not an object' }
  if (!OBS_ID_RE.test(String(obs.id))) return { ok: false, reason: 'bad id' }
  if (!DEVICE_RE.test(String(obs.device))) return { ok: false, reason: 'bad device' }
  const v = await verifyObservation(obs)
  if (!v.ok) return { ok: false, reason: v.idOk ? 'bad signature' : 'content hash mismatch' }

  const gps = obs.gps
  await env.DB.prepare(
    `INSERT INTO grove_observations
       (id, device, plot, species, count, co2_kg, biomass_kg,
        lat, lng, acc, observed_at, photo_hash, prev, raw, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(
    obs.id, obs.device, String(obs.plot).slice(0, 40), String(obs.species).slice(0, 40),
    Math.max(1, Math.round(Number(obs.count) || 1)), Number(obs.co2Kg) || 0, Number(obs.biomassKg) || 0,
    gps ? Number(gps.lat) : null, gps ? Number(gps.lng) : null, gps ? Math.round(Number(gps.acc)) : null,
    String(obs.observedAt).slice(0, 40), String(obs.photoHash).slice(0, 80),
    obs.prev ? String(obs.prev).slice(0, 64) : null,
    JSON.stringify(obs), new Date().toISOString(),
  ).run()
  return { ok: true, id: obs.id }
}

/**
 * Submit a signed attestation (a third-party co-signature on an observation —
 * the decentralized trust layer). Re-verified before storing; idempotent.
 */
async function groveAttest(request: Request, env: GroveEnv): Promise<Response> {
  let a: Attestation
  try {
    a = (await request.json()) as Attestation
  } catch {
    return json({ error: 'expected json' }, 400)
  }
  if (!a || a.kind !== 'attestation') return json({ error: 'not an attestation' }, 400)
  if (!OBS_ID_RE.test(String(a.id))) return json({ error: 'bad id' }, 400)
  if (!OBS_ID_RE.test(String(a.ref))) return json({ error: 'bad ref' }, 400)
  if (!DEVICE_RE.test(String(a.device))) return json({ error: 'bad device' }, 400)
  if (a.verdict !== 'confirm' && a.verdict !== 'dispute') return json({ error: 'bad verdict' }, 400)
  const v = await verifyAttestation(a)
  if (!v.ok) return json({ error: 'verification failed' }, 400)

  await env.DB.prepare(
    `INSERT INTO grove_attestations (id, ref, device, verdict, note, at, raw, created_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(a.id, a.ref, a.device, a.verdict, String(a.note ?? '').slice(0, 200),
    String(a.at).slice(0, 40), JSON.stringify(a), new Date().toISOString()).run()
  return json({ ok: true, id: a.id })
}

// Public aggregate — live totals for a dashboard's headline numbers.
async function groveStats(env: GroveEnv): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS observations, COUNT(DISTINCT device) AS devices,
            COUNT(DISTINCT plot) AS plots, COALESCE(SUM(count), 0) AS plants,
            COALESCE(SUM(co2_kg), 0) AS co2Kg FROM grove_observations`,
  ).first<{ observations: number; devices: number; plots: number; plants: number; co2Kg: number }>()
  return new Response(
    JSON.stringify({
      observations: row?.observations ?? 0,
      devices: row?.devices ?? 0,
      plots: row?.plots ?? 0,
      plants: row?.plants ?? 0,
      co2Kg: Math.round((row?.co2Kg ?? 0) * 100) / 100,
    }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

// Public feed: recent verified observations, newest first. GPS is coarsened to
// ~2 decimals (~1 km) so the public aggregate can map activity without exposing
// a contributor's exact garden. Raw signed bytes are NOT served here — fetch a
// single observation for the verifiable record.
async function groveFeed(url: URL, env: GroveEnv): Promise<Response> {
  const since = url.searchParams.get('since') ?? '1970-01-01T00:00:00.000Z'
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100)))
  const { results } = await env.DB.prepare(
    `SELECT id, device, plot, species, count, co2_kg AS co2Kg,
            lat, lng, observed_at AS observedAt, prev, created_at AS createdAt
       FROM grove_observations
      WHERE created_at > ?
      ORDER BY created_at DESC LIMIT ?`,
  ).bind(since, limit).all()
  const rows = (results ?? []) as Record<string, unknown>[]
  const items = rows.map((o) => ({
    ...o, lat: fuzz(o.lat as number | null), lng: fuzz(o.lng as number | null),
  }))
  const cursor = rows.length ? String(rows[0].createdAt) : since
  return new Response(JSON.stringify({ items, cursor }), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=15' },
  })
}

// Coarsen a coordinate to ~2 decimals for the public feed (privacy).
function fuzz(v: number | null): number | null {
  return v == null ? null : Math.round(v * 100) / 100
}

// A plot's full growth chain (oldest → newest) with a transparent trust score
// per record, computed from the attestations this node has verified.
async function grovePlot(plot: string, env: GroveEnv): Promise<Response> {
  if (!PLOT_RE.test(plot)) return json({ error: 'bad plot' }, 400)
  const { results } = await env.DB.prepare(
    `SELECT raw FROM grove_observations WHERE plot = ? ORDER BY observed_at ASC, created_at ASC LIMIT 500`,
  ).bind(plot).all()
  const observations: GardenObservation[] = (results ?? []).map(
    (r) => JSON.parse((r as { raw: string }).raw) as GardenObservation,
  )
  const scored = await Promise.all(observations.map(async (o) => {
    const atts = await attestationsFor(o.id, env)
    return { observation: o, attestations: atts, trust: trustScore(o, atts) }
  }))
  const totalCo2 = Math.round(observations.reduce((s, o) => s + (o.co2Kg || 0), 0) * 100) / 100
  return new Response(JSON.stringify({ plot, totalCo2, records: scored }), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' },
  })
}

// A single observation with its **raw signed bytes** (so any consumer can
// re-verify or federate it) plus its attestations and trust score.
async function groveObservation(id: string, env: GroveEnv): Promise<Response> {
  if (!OBS_ID_RE.test(id)) return json({ error: 'bad id' }, 400)
  const row = await env.DB.prepare('SELECT raw FROM grove_observations WHERE id = ?')
    .bind(id).first<{ raw: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  const observation = JSON.parse(row.raw) as GardenObservation
  const attestations = await attestationsFor(id, env)
  return new Response(
    JSON.stringify({ observation, attestations, trust: trustScore(observation, attestations) }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

async function attestationsFor(ref: string, env: GroveEnv): Promise<Attestation[]> {
  const { results } = await env.DB.prepare(
    'SELECT raw FROM grove_attestations WHERE ref = ? ORDER BY created_at ASC LIMIT 100',
  ).bind(ref).all()
  return (results ?? []).map((r) => JSON.parse((r as { raw: string }).raw) as Attestation)
}
