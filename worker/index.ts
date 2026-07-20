/**
 * iAny edge worker: static assets + pull-through model mirror.
 *
 * Client devices often cannot reach huggingface.co directly (carrier DNS
 * blocks etc.), so the app downloads models from /models/* on its own
 * origin. This worker serves those from R2, and on a cache miss fetches
 * the file from Hugging Face through Cloudflare's network, streams it to
 * the client and stores it in R2 in the same pass. After the first
 * download, models are served entirely from R2 (free egress).
 */

import { serveTrace } from '../trace/worker/handlers'

interface Env {
  MODELS: R2Bucket
  ASSETS: Fetcher
  /** iAny Radio news store (Cloudflare D1). */
  DB: D1Database
  /** Secret for creating/enabling outlets (POST /radio/admin/*). Set via
   *  `wrangler secret put RADIO_ADMIN_TOKEN`. */
  RADIO_ADMIN_TOKEN?: string
}

const HF = 'https://huggingface.co'
const TESSDATA_BEST = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main'
const TESSDATA_FAST = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main'
// Only mirror the models iAny actually uses — this endpoint must not be an
// open proxy.
const ALLOWED_PREFIXES = [
  // PWA (Transformers.js / ONNX) — semantic search + answering models.
  'onnx-community/embeddinggemma-300m-ONNX/', // semantic search
  'sengtha/iany-khmer-tiny-v1-ONNX/', // iAny Khmer 270M (default)
  'onnx-community/gemma-3-1b-it-ONNX-GQA/', // Gemma 3 1B
  'onnx-community/gemma-4-E2B-it-ONNX/', // Gemma 4 E2B
  'onnx-community/gemma-4-E4B-it-ONNX/', // Gemma 4 E4B
  // Mobile (llama.rn / GGUF) — embedder + Khmer LLM.
  'ggml-org/embeddinggemma-300M-GGUF/', // semantic search (matches the PWA for portable packs)
  'sengtha/Qwen3-0.6B-khm-ft3-Q8_0-GGUF/', // iAny Khmer LLM (Q4 + Q8)
  // Shared on-device models.
  'sengtha/khmer-tts-female-v2/', // Khmer TTS voice (Radio)
  'sengtha/khmer-ocr/', // Khmer OCR — detector + recognizer
  'sengtha/whisper-tiny-khmer/', // Khmer STT (whisper.rn GGML + ct2/onnx)
  'sengtha/mediapipe-hand/', // MediaPipe hand_landmarker.task (KSL /sign collector)
  'sengtha/mediapipe-embed/', // MediaPipe Image Embedder (Trace "better matching")
  'sengtha/mediapipe-detector/', // MediaPipe Object Detector (EfficientDet, /traffic)
  'sengtha/mediapipe-classifier/', // MediaPipe Image Classifier (EfficientNet-Lite, live /waste guess)
]
// OCR language data, served through the same mirror. Khmer uses the
// high-accuracy models; English's fast model is accurate enough.
const TESSDATA_RE = /^tessdata2\/(khm|eng)\.traineddata$/

function isAllowedKey(key: string): boolean {
  return ALLOWED_PREFIXES.some((p) => key.startsWith(p)) || TESSDATA_RE.test(key)
}

// Google hosts the MediaPipe Hand Landmarker model (Apache-2.0) publicly, so we
// mirror it from there instead of requiring a Hugging Face upload. Cached in R2
// on first fetch like every other model.
const MEDIAPIPE_HAND_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
// MediaPipe Image Embedder (MobileNetV3-small, ~4 MB, Apache-2.0) — the optional
// "better matching" model for Trace. Mirrored from Google's model storage.
const MEDIAPIPE_EMBED_URL =
  'https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite'
// MediaPipe Object Detector (EfficientDet-Lite0 float32, ~13.8 MB, Apache-2.0) —
// the live vehicle/people detector for /traffic. float32 (not int8) because the
// GPU delegate needs a float model — int8 loads but silently detects nothing.
// Mirrored from Google's model storage.
const MEDIAPIPE_DETECTOR_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite'
// MediaPipe Image Classifier (EfficientNet-Lite0 int8, ~5.4 MB, Apache-2.0) — the
// pretrained ImageNet classifier that powers the live /waste "guess" until a
// purpose-trained waste model exists. Mirrored from Google's model storage.
const MEDIAPIPE_CLASSIFIER_URL =
  'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/int8/1/efficientnet_lite0.tflite'

function upstreamUrl(key: string, hfPath: string): string {
  if (key.startsWith('tessdata2/')) {
    const file = key.slice('tessdata2/'.length)
    return `${file.startsWith('khm') ? TESSDATA_BEST : TESSDATA_FAST}/${file}`
  }
  if (key.startsWith('sengtha/mediapipe-hand/')) {
    return MEDIAPIPE_HAND_URL
  }
  if (key.startsWith('sengtha/mediapipe-embed/')) {
    return MEDIAPIPE_EMBED_URL
  }
  if (key.startsWith('sengtha/mediapipe-detector/')) {
    return MEDIAPIPE_DETECTOR_URL
  }
  if (key.startsWith('sengtha/mediapipe-classifier/')) {
    return MEDIAPIPE_CLASSIFIER_URL
  }
  return `${HF}/${hfPath}`
}
// Below this size, buffer instead of streaming: small JSON/tokenizer files
// may arrive compressed (content-length != stream length), which breaks
// FixedLengthStream-based R2 puts.
const BUFFER_LIMIT = 10 * 1024 * 1024

// Encrypted client-side backups (see src/lib/backup.ts). The id is derived
// from the user's recovery code; the payload is AES-GCM ciphertext the
// server cannot read. Free during beta — the future credits system gates
// this endpoint.
const BACKUP_MAX_BYTES = 50 * 1024 * 1024
const BACKUP_ID_RE = /^[0-9a-f]{64}$/

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/models/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 })
      }
      return serveModel(url, request, env, ctx)
    }
    if (url.pathname.startsWith('/api/backup/')) {
      return serveBackup(url, request, env)
    }
    if (url.pathname.startsWith('/hf-api/')) {
      return serveHfApi(url)
    }
    if (url.pathname.startsWith('/radio/')) {
      return serveRadio(url, request, env)
    }
    if (url.pathname.startsWith('/api/voice/')) {
      return serveVoice(url, request, env)
    }
    if (url.pathname.startsWith('/api/ocr/')) {
      return serveOcr(url, request, env)
    }
    if (url.pathname.startsWith('/api/sign/')) {
      return serveSign(url, request, env)
    }
    if (url.pathname.startsWith('/api/crop/')) {
      return serveCrop(url, request, env)
    }
    if (url.pathname.startsWith('/api/health-test/')) {
      return serveHealthTest(url, request, env)
    }
    if (url.pathname.startsWith('/api/water/')) {
      return serveWater(url, request, env)
    }
    if (url.pathname.startsWith('/api/waste/')) {
      return serveWaste(url, request, env)
    }
    if (url.pathname.startsWith('/api/species/')) {
      return serveSpecies(url, request, env)
    }
    if (url.pathname.startsWith('/api/report/')) {
      return serveReport(url, request, env)
    }
    if (url.pathname.startsWith('/api/street/')) {
      return serveStreet(url, request, env)
    }
    if (url.pathname.startsWith('/download/')) {
      return serveApk(request, env)
    }
    if (url.pathname.startsWith('/api/trace/')) {
      return serveTrace(url, request, env)
    }
    // The standalone "Contribute your voice" page (voice.html) is served
    // directly by the asset layer at the clean URL /voice — Cloudflare maps
    // /voice → voice.html natively, so the worker must NOT intercept it (doing
    // so causes an /voice ↔ /voice.html redirect loop).
    // Static assets: cross-origin isolation headers come from public/_headers
    // (asset requests bypass this worker via run_worker_first). That
    // isolation lets onnxruntime-web use multiple WASM threads — 2-4x faster
    // CPU inference on phones. Worker-served model/backup responses carry a
    // matching CORP header (see fileHeaders / serveBackup).
    return env.ASSETS.fetch(request)
  },

  // Daily cron (see wrangler.jsonc triggers): purge news past its 7-day TTL.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM news WHERE expires_at < ?')
        .bind(new Date().toISOString())
        .run()
        .then(() => undefined),
    )
  },
}

/* ------------------------------------------------------------------ *
 * iAny Radio — verified outlets POST news; the app pulls /feed and    *
 * reads it with the on-device Khmer TTS. See docs/RADIO-KHMER.md.     *
 * Shared contracts/validation come from @iany/core (radio.ts).        *
 * ------------------------------------------------------------------ */

import { RADIO_LIMITS, withinLatinBudget, type NewsSubmission } from '../packages/core/src/radio'

const JSON_HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

async function serveRadio(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/radio/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type' },
    })
  }
  if (path === 'feed' && request.method === 'GET') return radioFeed(url, env)
  if (path === 'news' && request.method === 'POST') return radioPostNews(request, env)
  if (path === 'my' || path.startsWith('my/')) return serveRadioMine(path, request, env)
  if (path === 'admin' || path.startsWith('admin/')) return serveRadioAdmin(path, request, env)
  return json({ error: 'not found' }, 404)
}

// Outlet self-service (Bearer = the outlet's own token): list / edit / delete
// its OWN news. Backs the "My posts" section of public/outlet.html.
async function serveRadioMine(path: string, request: Request, env: Env): Promise<Response> {
  const outlet = await authOutlet(request, env)
  if (!outlet) return json({ error: 'invalid token' }, 401)
  if (!outlet.verified || !outlet.active) return json({ error: 'outlet not enabled' }, 403)
  const seg = path.split('/') // ['my', 'news', id?]
  const id = seg[2]
  const m = request.method
  if (seg[1] === 'news' && !id && m === 'GET') return radioMineList(outlet.id, env)
  if (seg[1] === 'news' && id && m === 'POST') return radioMineEdit(outlet, id, request, env)
  if (seg[1] === 'news' && id && m === 'DELETE') return radioMineDelete(outlet.id, id, env)
  return json({ error: 'not found' }, 404)
}

// Admin surface (all require the RADIO_ADMIN_TOKEN bearer): issue API keys,
// manage outlets, manage news. Backs public/admin.html.
async function serveRadioAdmin(path: string, request: Request, env: Env): Promise<Response> {
  if (!env.RADIO_ADMIN_TOKEN || bearer(request) !== env.RADIO_ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401)
  }
  const seg = path.split('/') // ['admin', kind, id?, action?]
  const kind = seg[1]
  const id = seg[2]
  const action = seg[3]
  const m = request.method

  if (kind === 'outlets' && m === 'GET') return adminListOutlets(env)
  if (kind === 'outlet' && !id && m === 'POST') return radioCreateOutlet(request, env)
  if (kind === 'outlet' && id && action === 'rotate' && m === 'POST') return adminRotateToken(id, env)
  if (kind === 'outlet' && id && action === 'active' && m === 'POST') return adminSetActive(id, request, env)
  if (kind === 'outlet' && id && !action && m === 'DELETE') return adminDeleteOutlet(id, env)
  if (kind === 'news' && m === 'GET') return adminListNews(env)
  if (kind === 'news' && id && m === 'DELETE') return adminDeleteNews(id, env)
  return json({ error: 'not found' }, 404)
}

// Public, read-only: active items newer than ?since, newest first.
async function radioFeed(url: URL, env: Env): Promise<Response> {
  const since = url.searchParams.get('since') ?? '1970-01-01T00:00:00.000Z'
  const now = new Date().toISOString()
  const { results } = await env.DB.prepare(
    `SELECT id, outlet_id AS outletId, outlet_name AS outletName, title, body,
            sponsor,
            lang, created_at AS createdAt, expires_at AS expiresAt
       FROM news WHERE expires_at > ? AND created_at > ?
       ORDER BY created_at DESC LIMIT 50`,
  ).bind(now, since).all()
  const items = results ?? []
  const cursor = items.length ? (items[0] as { createdAt: string }).createdAt : since
  return new Response(JSON.stringify({ items, cursor }), {
    headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=10' },
  })
}

interface Outlet {
  id: string
  name: string
  verified: number
  active: number
}

// Resolve the outlet from its Bearer token (hash compare), or null.
async function authOutlet(request: Request, env: Env): Promise<Outlet | null> {
  const token = bearer(request)
  if (!token) return null
  const hash = await sha256hex(token)
  return env.DB.prepare(
    'SELECT id, name, verified, active FROM outlets WHERE token_hash = ?',
  ).bind(hash).first<Outlet>()
}

// Shared title/body/sponsor validation (length limits + the Khmer-script rule).
// Returns the cleaned fields, or an error Response to short-circuit with.
function validateNews(
  body: NewsSubmission,
): { title: string; text: string; sponsor: string } | { error: Response } {
  const title = (body.title ?? '').trim()
  const text = (body.body ?? '').trim()
  const sponsor = (body.sponsor ?? '').trim()
  if (!title || !text) return { error: json({ error: 'title and body required' }, 400) }
  if (title.length > RADIO_LIMITS.titleMax || text.length > RADIO_LIMITS.bodyMax ||
      sponsor.length > RADIO_LIMITS.sponsorMax) {
    return { error: json({ error: 'too long' }, 400) }
  }
  if (!withinLatinBudget(text)) {
    return {
      error: json(
        { error: 'សូមសរសេរពាក្យបរទេសជាអក្សរខ្មែរ (write foreign words in Khmer script)' },
        422,
      ),
    }
  }
  return { title, text, sponsor }
}

async function readJson(request: Request): Promise<NewsSubmission | null> {
  try {
    return (await request.json()) as NewsSubmission
  } catch {
    return null
  }
}

// Outlet-authenticated post. Enforces length limits + the Khmer-script rule.
async function radioPostNews(request: Request, env: Env): Promise<Response> {
  const outlet = await authOutlet(request, env)
  if (!outlet) return json({ error: 'invalid token' }, 401)
  if (!outlet.verified || !outlet.active) return json({ error: 'outlet not enabled' }, 403)

  const body = await readJson(request)
  if (!body) return json({ error: 'bad json' }, 400)
  const v = validateNews(body)
  if ('error' in v) return v.error

  const id = crypto.randomUUID()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + RADIO_LIMITS.ttlDays * 86400_000)
  await env.DB.prepare(
    `INSERT INTO news (id, outlet_id, outlet_name, title, body, sponsor, lang, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(id, outlet.id, outlet.name, v.title, v.text, v.sponsor || null,
    body.lang === 'en' ? 'en' : 'km', createdAt.toISOString(), expiresAt.toISOString()).run()
  return json({ id, expiresAt: expiresAt.toISOString() })
}

// List this outlet's OWN news (newest first, incl. near-expiry, with previews).
async function radioMineList(outletId: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, title, substr(body, 1, 200) AS bodyPreview, body, sponsor,
            created_at AS createdAt, expires_at AS expiresAt
       FROM news WHERE outlet_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(outletId).all()
  return json({ news: results ?? [] })
}

// Edit one of this outlet's OWN articles (re-validated). TTL is unchanged.
async function radioMineEdit(
  outlet: Outlet,
  id: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson(request)
  if (!body) return json({ error: 'bad json' }, 400)
  const v = validateNews(body)
  if ('error' in v) return v.error
  const r = await env.DB.prepare(
    'UPDATE news SET title = ?, body = ?, sponsor = ?, lang = ? WHERE id = ? AND outlet_id = ?',
  ).bind(v.title, v.text, v.sponsor || null, body.lang === 'en' ? 'en' : 'km', id, outlet.id).run()
  if (!r.meta.changes) return json({ error: 'not found' }, 404)
  return json({ id, updated: true })
}

// Delete one of this outlet's OWN articles (scoped to the owner).
async function radioMineDelete(outletId: string, id: string, env: Env): Promise<Response> {
  const r = await env.DB.prepare('DELETE FROM news WHERE id = ? AND outlet_id = ?')
    .bind(id, outletId).run()
  if (!r.meta.changes) return json({ error: 'not found' }, 404)
  return json({ id, deleted: true })
}

// Admin-only: create a verified outlet, return its token ONCE (only the hash is stored).
async function radioCreateOutlet(request: Request, env: Env): Promise<Response> {
  if (!env.RADIO_ADMIN_TOKEN || bearer(request) !== env.RADIO_ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401)
  }
  let payload: { name?: string }
  try {
    payload = (await request.json()) as { name?: string }
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  const name = (payload.name ?? '').trim()
  if (!name) return json({ error: 'name required' }, 400)
  const id = crypto.randomUUID()
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  await env.DB.prepare(
    'INSERT INTO outlets (id, name, token_hash, verified, active, created_at) VALUES (?,?,?,1,1,?)',
  ).bind(id, name, await sha256hex(token), new Date().toISOString()).run()
  // token is shown once; store the hash only.
  return json({ id, name, token })
}

// List every outlet with its live (non-expired) news count. No tokens — those
// are never recoverable (only the hash is stored); use rotate to reissue.
async function adminListOutlets(env: Env): Promise<Response> {
  const now = new Date().toISOString()
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.name, o.verified, o.active, o.created_at AS createdAt,
            (SELECT COUNT(*) FROM news n WHERE n.outlet_id = o.id AND n.expires_at > ?) AS liveCount
       FROM outlets o ORDER BY o.created_at DESC`,
  ).bind(now).all()
  return json({ outlets: results ?? [] })
}

// Reissue an outlet's API key: mint a new token, replace the stored hash, and
// return the plaintext ONCE. The old token stops working immediately.
async function adminRotateToken(id: string, env: Env): Promise<Response> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const r = await env.DB.prepare('UPDATE outlets SET token_hash = ? WHERE id = ?')
    .bind(await sha256hex(token), id).run()
  if (!r.meta.changes) return json({ error: 'outlet not found' }, 404)
  return json({ id, token })
}

// Enable / disable an outlet (the kill switch). Disabled outlets can't post.
async function adminSetActive(id: string, request: Request, env: Env): Promise<Response> {
  let payload: { active?: boolean }
  try {
    payload = (await request.json()) as { active?: boolean }
  } catch {
    return json({ error: 'bad json' }, 400)
  }
  const r = await env.DB.prepare('UPDATE outlets SET active = ? WHERE id = ?')
    .bind(payload.active ? 1 : 0, id).run()
  if (!r.meta.changes) return json({ error: 'outlet not found' }, 404)
  return json({ id, active: payload.active ? 1 : 0 })
}

// Delete an outlet and all its news.
async function adminDeleteOutlet(id: string, env: Env): Promise<Response> {
  await env.DB.prepare('DELETE FROM news WHERE outlet_id = ?').bind(id).run()
  const r = await env.DB.prepare('DELETE FROM outlets WHERE id = ?').bind(id).run()
  if (!r.meta.changes) return json({ error: 'outlet not found' }, 404)
  return json({ id, deleted: true })
}

// List recent news for moderation (includes items near expiry). Body trimmed.
async function adminListNews(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, outlet_id AS outletId, outlet_name AS outletName, title,
            substr(body, 1, 160) AS bodyPreview, sponsor,
            created_at AS createdAt, expires_at AS expiresAt
       FROM news ORDER BY created_at DESC LIMIT 100`,
  ).all()
  return json({ news: results ?? [] })
}

// Delete a single news item (before its 7-day TTL).
async function adminDeleteNews(id: string, env: Env): Promise<Response> {
  const r = await env.DB.prepare('DELETE FROM news WHERE id = ?').bind(id).run()
  if (!r.meta.changes) return json({ error: 'news not found' }, 404)
  return json({ id, deleted: true })
}

/* ------------------------------------------------------------------ *
 * Contribute your voice — the standalone /voice page POSTs             *
 * (audio, sentence) pairs that become an OPEN Khmer STT training set.  *
 * Served under /api/voice/* (a separate route from the iAny app).      *
 * Audio → R2 (voice/…), metadata → D1 (voice_clips). Public: submit a  *
 * clip + aggregate stats. Admin (RADIO_ADMIN_TOKEN): list / download / *
 * delete for export. See docs/VOICE-COLLECTION.md.                     *
 * ------------------------------------------------------------------ */

const VOICE_MAX_BYTES = 5 * 1024 * 1024 // ~5 MB WAV — a spoken sentence is tiny
const VOICE_SENTENCE_MAX = 400
const VOICE_SPEAKER_RE = /^s-[0-9a-z]{6,16}$/

async function serveVoice(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/voice/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type' },
    })
  }
  try {
    if (path === 'clip' && request.method === 'POST') return await voicePostClip(request, env)
    if (path === 'stats' && request.method === 'GET') return await voiceStats(env)
    if (path === 'admin' || path.startsWith('admin/')) return await serveVoiceAdmin(path, request, env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    // Most likely the voice_clips table hasn't been created yet — surface a
    // legible hint instead of a raw Worker 1101 crash.
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|voice_clips/i.test(msg)
      ? 'voice storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Public: accept one recording. multipart/form-data with `audio` + metadata.
async function voicePostClip(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('audio') as unknown
  const sentence = String(form.get('sentence') ?? '').trim()
  const speaker = String(form.get('speaker') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  // A form entry is a File (a Blob) or a string; anything non-string is audio.
  if (!entry || typeof entry === 'string') return json({ error: 'audio required' }, 400)
  const audio = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!sentence || sentence.length > VOICE_SENTENCE_MAX) return json({ error: 'bad sentence' }, 400)
  if (!VOICE_SPEAKER_RE.test(speaker)) return json({ error: 'bad speaker id' }, 400)
  const size = audio.size
  if (!size || size > VOICE_MAX_BYTES) return json({ error: 'audio too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const r2Key = `voice/${day}/${id}.wav`
  await env.MODELS.put(r2Key, await audio.arrayBuffer(), {
    httpMetadata: { contentType: 'audio/wav' },
    customMetadata: { speaker, sentenceId: String(form.get('sentenceId') ?? '') },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const durationMs = Number(form.get('durationMs') ?? 0) || null
  await env.DB.prepare(
    `INSERT INTO voice_clips
       (id, r2_key, speaker, sentence, sentence_id, lang, credit_name,
        class_label, gender, age_band, region, duration_ms, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, speaker, sentence, trim('sentenceId', 40), 'km', trim('creditName', 60),
    trim('classLabel', 24), trim('gender', 10), trim('ageBand', 10), trim('region', 40),
    durationMs, size, now.toISOString(),
  ).run()
  return json({ id })
}

// Public, aggregate only (no PII) — motivates a class with live totals.
async function voiceStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS clips, COUNT(DISTINCT speaker) AS speakers,
            COALESCE(SUM(duration_ms), 0) AS ms FROM voice_clips`,
  ).first<{ clips: number; speakers: number; ms: number }>()
  return new Response(
    JSON.stringify({
      clips: row?.clips ?? 0,
      speakers: row?.speakers ?? 0,
      hours: Math.round(((row?.ms ?? 0) / 3600000) * 10) / 10,
    }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

// Admin (RADIO_ADMIN_TOKEN): paginated list, single-clip download, delete —
// the export script (scripts/export-voice.mjs) uses list + clip.
async function serveVoiceAdmin(path: string, request: Request, env: Env): Promise<Response> {
  if (!env.RADIO_ADMIN_TOKEN || bearer(request) !== env.RADIO_ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401)
  }
  const seg = path.split('/') // ['admin', kind, id?]
  const kind = seg[1]
  const id = seg[2]
  const m = request.method
  if (kind === 'clips' && m === 'GET') return voiceAdminList(request, env)
  if (kind === 'clip' && id && m === 'GET') return voiceAdminGet(id, env)
  if (kind === 'clip' && id && m === 'DELETE') return voiceAdminDelete(id, env)
  return json({ error: 'not found' }, 404)
}

// Page through clips oldest-first (stable for export). ?after=<created_at,id>.
async function voiceAdminList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const after = url.searchParams.get('after') ?? ''
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200)))
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key AS r2Key, speaker, sentence, sentence_id AS sentenceId, lang,
            credit_name AS creditName, class_label AS classLabel, gender,
            age_band AS ageBand, region, duration_ms AS durationMs, bytes,
            created_at AS createdAt
       FROM voice_clips
      WHERE (created_at || '|' || id) > ?
      ORDER BY created_at ASC, id ASC LIMIT ?`,
  ).bind(after, limit).all()
  const items = results ?? []
  const last = items.length
    ? (items[items.length - 1] as { createdAt: string; id: string })
    : null
  return json({ clips: items, next: last ? `${last.createdAt}|${last.id}` : null })
}

async function voiceAdminGet(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT r2_key AS r2Key FROM voice_clips WHERE id = ?')
    .bind(id).first<{ r2Key: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  const obj = await env.MODELS.get(row.r2Key)
  if (!obj) return json({ error: 'audio missing' }, 404)
  return new Response(obj.body, {
    headers: { 'content-type': 'audio/wav', 'content-length': String(obj.size),
      'access-control-allow-origin': '*' },
  })
}

async function voiceAdminDelete(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT r2_key AS r2Key FROM voice_clips WHERE id = ?')
    .bind(id).first<{ r2Key: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  await env.MODELS.delete(row.r2Key)
  await env.DB.prepare('DELETE FROM voice_clips WHERE id = ?').bind(id).run()
  return json({ id, deleted: true })
}

/* ------------------------------------------------------------------ *
 * Contribute Khmer text photos — the standalone /scan page POSTs      *
 * (image, transcript) pairs that become an OPEN Khmer OCR training    *
 * set. Served under /api/ocr/* (a separate route from the iAny app).  *
 * Image → R2 (ocr/…), metadata → D1 (ocr_samples). Public: submit a   *
 * sample + aggregate stats. Admin (RADIO_ADMIN_TOKEN): list /         *
 * download / delete for export. See docs/OCR-COLLECTION.md.           *
 * ------------------------------------------------------------------ */

const OCR_MAX_BYTES = 8 * 1024 * 1024 // ~8 MB image
const OCR_TEXT_MAX = 2000
const OCR_DEVICE_RE = /^d-[0-9a-z]{6,16}$/

async function serveOcr(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/ocr/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await ocrPostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await ocrStats(env)
    if (path === 'admin' || path.startsWith('admin/')) return await serveOcrAdmin(path, request, env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|ocr_samples/i.test(msg)
      ? 'ocr storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Public: accept one (image, transcript) sample. multipart/form-data.
async function ocrPostSample(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('image') as unknown
  const text = String(form.get('text') ?? '').trim()
  const device = String(form.get('device') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  if (!entry || typeof entry === 'string') return json({ error: 'image required' }, 400)
  const image = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!text || text.length > OCR_TEXT_MAX) return json({ error: 'bad text' }, 400)
  if (!OCR_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  const size = image.size
  if (!size || size > OCR_MAX_BYTES) return json({ error: 'image too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const type = image.type === 'image/png' ? 'png' : 'jpg'
  const r2Key = `ocr/${day}/${id}.${type}`
  await env.MODELS.put(r2Key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/jpeg' },
    customMetadata: { device },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const num = (k: string): number | null => {
    const v = Number(form.get(k) ?? 0)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  await env.DB.prepare(
    `INSERT INTO ocr_samples
       (id, r2_key, device, text, ocr_guess, credit_name, region, width, height, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, text, trim('ocrGuess', OCR_TEXT_MAX), trim('creditName', 60),
    trim('region', 40), num('width'), num('height'), size, now.toISOString(),
  ).run()
  return json({ id })
}

// Public, aggregate only — motivates contributors with live totals.
async function ocrStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices FROM ocr_samples`,
  ).first<{ samples: number; devices: number }>()
  return new Response(
    JSON.stringify({ samples: row?.samples ?? 0, devices: row?.devices ?? 0 }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

// Admin (RADIO_ADMIN_TOKEN): paginated list, single-image download, delete.
async function serveOcrAdmin(path: string, request: Request, env: Env): Promise<Response> {
  if (!env.RADIO_ADMIN_TOKEN || bearer(request) !== env.RADIO_ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401)
  }
  const seg = path.split('/') // ['admin', kind, id?]
  const kind = seg[1]
  const id = seg[2]
  const m = request.method
  if (kind === 'samples' && m === 'GET') return ocrAdminList(request, env)
  if (kind === 'image' && id && m === 'GET') return ocrAdminGet(id, env)
  if (kind === 'sample' && id && m === 'DELETE') return ocrAdminDelete(id, env)
  return json({ error: 'not found' }, 404)
}

async function ocrAdminList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const after = url.searchParams.get('after') ?? ''
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200)))
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key AS r2Key, device, text, ocr_guess AS ocrGuess, credit_name AS creditName,
            region, width, height, bytes, created_at AS createdAt
       FROM ocr_samples
      WHERE (created_at || '|' || id) > ?
      ORDER BY created_at ASC, id ASC LIMIT ?`,
  ).bind(after, limit).all()
  const items = results ?? []
  const last = items.length ? (items[items.length - 1] as { createdAt: string; id: string }) : null
  return json({ samples: items, next: last ? `${last.createdAt}|${last.id}` : null })
}

async function ocrAdminGet(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT r2_key AS r2Key FROM ocr_samples WHERE id = ?')
    .bind(id).first<{ r2Key: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  const obj = await env.MODELS.get(row.r2Key)
  if (!obj) return json({ error: 'image missing' }, 404)
  return new Response(obj.body, {
    headers: { 'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      'content-length': String(obj.size), 'access-control-allow-origin': '*' },
  })
}

async function ocrAdminDelete(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT r2_key AS r2Key FROM ocr_samples WHERE id = ?')
    .bind(id).first<{ r2Key: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  await env.MODELS.delete(row.r2Key)
  await env.DB.prepare('DELETE FROM ocr_samples WHERE id = ?').bind(id).run()
  return json({ id, deleted: true })
}

/* ------------------------------------------------------------------ *
 * Contribute Khmer Sign Language — the standalone /sign page POSTs    *
 * (label, hand-landmark sequence) pairs that become an OPEN Khmer     *
 * Sign Language training set. Served under /api/sign/*. We store only *
 * landmarks (JSON), never video — tiny + identity-free.               *
 * Sequence → R2 (sign/…), metadata → D1 (sign_samples). Public:       *
 * submit a sample + aggregate stats. Admin (RADIO_ADMIN_TOKEN):       *
 * list / download / delete for export. See docs/SIGN-COLLECTION.md.   *
 * ------------------------------------------------------------------ */

const SIGN_MAX_FRAMES = 200 // ~10 s at 20 fps — plenty for one gesture
const SIGN_MAX_BYTES = 1 * 1024 * 1024 // 1 MB of landmark JSON is already huge
const SIGN_DEVICE_RE = /^g-[0-9a-z]{6,16}$/

async function serveSign(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/sign/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await signPostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await signStats(env)
    if (path === 'admin' || path.startsWith('admin/')) return await serveSignAdmin(path, request, env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|sign_samples/i.test(msg)
      ? 'sign storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Public: accept one (label, landmark sequence) sample. application/json.
async function signPostSample(request: Request, env: Env): Promise<Response> {
  let body: {
    device?: string
    consent?: boolean
    promptId?: string
    label?: string
    fps?: number
    frames?: unknown
    creditName?: string
    region?: string
  }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'expected json body' }, 400)
  }
  const device = String(body.device ?? '').trim()
  const label = String(body.label ?? '').trim()
  const promptId = String(body.promptId ?? '').trim()
  const frames = body.frames

  if (body.consent !== true) return json({ error: 'consent required' }, 403)
  if (!SIGN_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  if (!label || label.length > 80) return json({ error: 'bad label' }, 400)
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > SIGN_MAX_FRAMES) {
    return json({ error: 'bad frames' }, 400)
  }
  const withHands = frames.filter(
    (f) => f && typeof f === 'object' && Array.isArray((f as { hands?: unknown }).hands) &&
      (f as { hands: unknown[] }).hands.length > 0,
  ).length
  if (withHands < 3) return json({ error: 'no hands detected in sample' }, 400)

  const fps = Number(body.fps)
  const payload = JSON.stringify({
    label,
    promptId,
    fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps) : null,
    frames,
  })
  const size = new TextEncoder().encode(payload).length
  if (size > SIGN_MAX_BYTES) return json({ error: 'sample too large' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const r2Key = `sign/${day}/${id}.json`
  await env.MODELS.put(r2Key, payload, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { device },
  })

  const trim = (v: string | undefined, max: number): string | null => {
    const s = (v ?? '').trim()
    return s ? s.slice(0, max) : null
  }
  await env.DB.prepare(
    `INSERT INTO sign_samples
       (id, r2_key, device, label, prompt_id, frames, hand_frames, credit_name, region, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, label, promptId || null, frames.length, withHands,
    trim(body.creditName, 60), trim(body.region, 40), size, now.toISOString(),
  ).run()
  return json({ id })
}

// Public, aggregate only — motivates contributors with live totals.
async function signStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices,
            COUNT(DISTINCT label) AS labels FROM sign_samples`,
  ).first<{ samples: number; devices: number; labels: number }>()
  return new Response(
    JSON.stringify({
      samples: row?.samples ?? 0,
      devices: row?.devices ?? 0,
      labels: row?.labels ?? 0,
    }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

// Admin (RADIO_ADMIN_TOKEN): paginated list, single-sequence download, delete.
async function serveSignAdmin(path: string, request: Request, env: Env): Promise<Response> {
  if (!env.RADIO_ADMIN_TOKEN || bearer(request) !== env.RADIO_ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401)
  }
  const seg = path.split('/') // ['admin', kind, id?]
  const kind = seg[1]
  const id = seg[2]
  const m = request.method
  if (kind === 'samples' && m === 'GET') return signAdminList(request, env)
  if (kind === 'sequence' && id && m === 'GET') return signAdminGet(id, env)
  if (kind === 'sample' && id && m === 'DELETE') return signAdminDelete(id, env)
  return json({ error: 'not found' }, 404)
}

async function signAdminList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const after = url.searchParams.get('after') ?? ''
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200)))
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key AS r2Key, device, label, prompt_id AS promptId, frames,
            hand_frames AS handFrames, credit_name AS creditName, region, bytes,
            created_at AS createdAt
       FROM sign_samples
      WHERE (created_at || '|' || id) > ?
      ORDER BY created_at ASC, id ASC LIMIT ?`,
  ).bind(after, limit).all()
  const items = results ?? []
  const last = items.length ? (items[items.length - 1] as { createdAt: string; id: string }) : null
  return json({ samples: items, next: last ? `${last.createdAt}|${last.id}` : null })
}

async function signAdminGet(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT r2_key AS r2Key FROM sign_samples WHERE id = ?')
    .bind(id).first<{ r2Key: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  const obj = await env.MODELS.get(row.r2Key)
  if (!obj) return json({ error: 'sequence missing' }, 404)
  return new Response(obj.body, {
    headers: { 'content-type': 'application/json',
      'content-length': String(obj.size), 'access-control-allow-origin': '*' },
  })
}

async function signAdminDelete(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT r2_key AS r2Key FROM sign_samples WHERE id = ?')
    .bind(id).first<{ r2Key: string }>()
  if (!row) return json({ error: 'not found' }, 404)
  await env.MODELS.delete(row.r2Key)
  await env.DB.prepare('DELETE FROM sign_samples WHERE id = ?').bind(id).run()
  return json({ id, deleted: true })
}

/* ------------------------------------------------------------------ *
 * /crop — crowd-sourced crop photos (crop + health condition) for an   *
 * open, offline crop-health classifier (MobileNetV3). Image → R2,      *
 * labels → D1. Public POST /api/crop/sample + GET /api/crop/stats.     *
 * ------------------------------------------------------------------ */

const CROP_MAX_BYTES = 8 * 1024 * 1024 // ~8 MB image
const CROP_DEVICE_RE = /^c-[0-9a-z]{6,16}$/
// Keep in sync with src/assets/cropLabels.ts (server-side allowlist so the label
// space stays clean for training).
const CROP_IDS = new Set([
  'rice', 'cassava', 'maize', 'banana', 'mango', 'vegetable',
  'chili', 'pepper', 'bean', 'sugarcane', 'rubber', 'other',
])
const CONDITION_IDS = new Set(['healthy', 'disease', 'pest', 'deficiency', 'unsure'])

async function serveCrop(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/crop/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await cropPostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await cropStats(env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|crop_samples/i.test(msg)
      ? 'crop storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Public: accept one (image, crop, condition) sample. multipart/form-data.
async function cropPostSample(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('image') as unknown
  const crop = String(form.get('crop') ?? '').trim()
  const condition = String(form.get('condition') ?? '').trim()
  const device = String(form.get('device') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  if (!entry || typeof entry === 'string') return json({ error: 'image required' }, 400)
  const image = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!CROP_IDS.has(crop)) return json({ error: 'bad crop' }, 400)
  if (!CONDITION_IDS.has(condition)) return json({ error: 'bad condition' }, 400)
  if (!CROP_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  const size = image.size
  if (!size || size > CROP_MAX_BYTES) return json({ error: 'image too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const type = image.type === 'image/png' ? 'png' : 'jpg'
  // Foldered by class so the R2 prefix already looks like an image dataset.
  const r2Key = `crop/${crop}/${condition}/${day}-${id}.${type}`
  await env.MODELS.put(r2Key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/jpeg' },
    customMetadata: { device, crop, condition },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const num = (k: string): number | null => {
    const v = Number(form.get(k) ?? 0)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  await env.DB.prepare(
    `INSERT INTO crop_samples
       (id, r2_key, device, crop, condition, note, credit_name, region, width, height, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, crop, condition, trim('note', 120), trim('creditName', 60),
    trim('region', 40), num('width'), num('height'), size, now.toISOString(),
  ).run()
  return json({ id })
}

// Public, aggregate only — live totals to motivate contributors.
async function cropStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices,
            COUNT(DISTINCT crop) AS crops FROM crop_samples`,
  ).first<{ samples: number; devices: number; crops: number }>()
  return new Response(
    JSON.stringify({ samples: row?.samples ?? 0, devices: row?.devices ?? 0, crops: row?.crops ?? 0 }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

/* ------------------------------------------------------------------ *
 * /health-test — crowd-sourced rapid diagnostic test (RDT) strip       *
 * photos for an OFFLINE model that READS the result line (positive /   *
 * negative / invalid) — reading, NOT diagnosing (see docs/HEALTH-AI.md)*
 * Strip photo → R2; test type + result → D1. Privacy: strip only.      *
 * ------------------------------------------------------------------ */

const HTEST_MAX_BYTES = 8 * 1024 * 1024
const HTEST_DEVICE_RE = /^h-[0-9a-z]{6,16}$/
// Keep in sync with src/assets/healthTestLabels.ts (server-side allowlist).
const HTEST_TESTS = new Set(['malaria', 'dengue', 'pregnancy', 'covid', 'other'])
const HTEST_RESULTS = new Set(['positive', 'negative', 'invalid'])

async function serveHealthTest(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/health-test/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await htestPostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await htestStats(env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|health_test_samples/i.test(msg)
      ? 'health-test storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Public: accept one (strip image, test, result) sample. multipart/form-data.
async function htestPostSample(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('image') as unknown
  const test = String(form.get('test') ?? '').trim()
  const result = String(form.get('result') ?? '').trim()
  const device = String(form.get('device') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  if (!entry || typeof entry === 'string') return json({ error: 'image required' }, 400)
  const image = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!HTEST_TESTS.has(test)) return json({ error: 'bad test' }, 400)
  if (!HTEST_RESULTS.has(result)) return json({ error: 'bad result' }, 400)
  if (!HTEST_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  const size = image.size
  if (!size || size > HTEST_MAX_BYTES) return json({ error: 'image too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const type = image.type === 'image/png' ? 'png' : 'jpg'
  const r2Key = `health-test/${test}/${result}/${day}-${id}.${type}`
  await env.MODELS.put(r2Key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/jpeg' },
    customMetadata: { device, test, result },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const num = (k: string): number | null => {
    const v = Number(form.get(k) ?? 0)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  await env.DB.prepare(
    `INSERT INTO health_test_samples
       (id, r2_key, device, test, result, note, credit_name, region, width, height, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, test, result, trim('note', 120), trim('creditName', 60),
    trim('region', 40), num('width'), num('height'), size, now.toISOString(),
  ).run()
  return json({ id })
}

async function htestStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices FROM health_test_samples`,
  ).first<{ samples: number; devices: number }>()
  return new Response(
    JSON.stringify({ samples: row?.samples ?? 0, devices: row?.devices ?? 0 }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

/* ------------------------------------------------------------------ *
 * /water — crowd-sourced water-quality test-strip photos for an        *
 * OFFLINE reader that maps a strip → safety band (safe/caution/unsafe) *
 * — guidance, not a certified measurement (see docs/ENVIRONMENT-AI.md).*
 * Strip photo → R2; test + level (+ source) → D1.                      *
 * ------------------------------------------------------------------ */

const WATER_MAX_BYTES = 8 * 1024 * 1024
const WATER_DEVICE_RE = /^w-[0-9a-z]{6,16}$/
// Keep in sync with src/assets/waterLabels.ts (server-side allowlist).
const WATER_TESTS = new Set(['arsenic', 'bacteria', 'ph', 'chlorine', 'nitrate', 'iron', 'other'])
const WATER_LEVELS = new Set(['safe', 'caution', 'unsafe', 'unclear'])
const WATER_SOURCES = new Set(['tubewell', 'dugwell', 'pond', 'rain', 'piped', 'bottled', 'other'])

async function serveWater(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/water/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await waterPostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await waterStats(env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|water_samples/i.test(msg)
      ? 'water storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Public: accept one (strip image, test, level) sample. multipart/form-data.
async function waterPostSample(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('image') as unknown
  const test = String(form.get('test') ?? '').trim()
  const level = String(form.get('level') ?? '').trim()
  const source = String(form.get('source') ?? '').trim()
  const device = String(form.get('device') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  if (!entry || typeof entry === 'string') return json({ error: 'image required' }, 400)
  const image = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!WATER_TESTS.has(test)) return json({ error: 'bad test' }, 400)
  if (!WATER_LEVELS.has(level)) return json({ error: 'bad level' }, 400)
  if (source && !WATER_SOURCES.has(source)) return json({ error: 'bad source' }, 400)
  if (!WATER_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  const size = image.size
  if (!size || size > WATER_MAX_BYTES) return json({ error: 'image too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const type = image.type === 'image/png' ? 'png' : 'jpg'
  // Foldered by test/level so the R2 prefix is already a labelled dataset.
  const r2Key = `water/${test}/${level}/${day}-${id}.${type}`
  await env.MODELS.put(r2Key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/jpeg' },
    customMetadata: { device, test, level },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const num = (k: string): number | null => {
    const v = Number(form.get(k) ?? 0)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  await env.DB.prepare(
    `INSERT INTO water_samples
       (id, r2_key, device, test, level, source, note, credit_name, region, width, height, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, test, level, source || null, trim('note', 120), trim('creditName', 60),
    trim('region', 40), num('width'), num('height'), size, now.toISOString(),
  ).run()
  return json({ id })
}

async function waterStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices FROM water_samples`,
  ).first<{ samples: number; devices: number }>()
  return new Response(
    JSON.stringify({ samples: row?.samples ?? 0, devices: row?.devices ?? 0 }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

/* ------------------------------------------------------------------ *
 * /waste — crowd-sourced waste/recyclable item photos for an OFFLINE   *
 * classifier (plastic bottle / can / glass / paper / …) — recycling    *
 * education + sorting help. Image → R2; type → D1.                     *
 * ------------------------------------------------------------------ */

const WASTE_MAX_BYTES = 8 * 1024 * 1024
const WASTE_DEVICE_RE = /^r-[0-9a-z]{6,16}$/
// Keep in sync with src/assets/wasteLabels.ts (server-side allowlist).
const WASTE_TYPES = new Set([
  'plastic_bottle', 'plastic_other', 'can', 'glass', 'paper', 'organic', 'ewaste', 'other',
])

async function serveWaste(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/waste/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await wastePostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await wasteStats(env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|waste_samples/i.test(msg)
      ? 'waste storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Public: accept one (image, type) sample. multipart/form-data.
async function wastePostSample(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('image') as unknown
  const type = String(form.get('type') ?? '').trim()
  const device = String(form.get('device') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  if (!entry || typeof entry === 'string') return json({ error: 'image required' }, 400)
  const image = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!WASTE_TYPES.has(type)) return json({ error: 'bad type' }, 400)
  if (!WASTE_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  const size = image.size
  if (!size || size > WASTE_MAX_BYTES) return json({ error: 'image too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const t = image.type === 'image/png' ? 'png' : 'jpg'
  const r2Key = `waste/${type}/${day}-${id}.${t}`
  await env.MODELS.put(r2Key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/jpeg' },
    customMetadata: { device, type },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const num = (k: string): number | null => {
    const v = Number(form.get(k) ?? 0)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  const geo = parseGeo(form)
  await env.DB.prepare(
    `INSERT INTO waste_samples
       (id, r2_key, device, type, note, credit_name, region, lat, lng, acc, width, height, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, type, trim('note', 120), trim('creditName', 60),
    trim('region', 40), geo.lat, geo.lng, geo.acc, num('width'), num('height'), size, now.toISOString(),
  ).run()
  return json({ id })
}

// Parse an optional GPS point (lat/lng/acc) from a form; returns nulls if absent
// or out of range. Shared by the mapping collectors (litter / species / reports).
function parseGeo(form: FormData): { lat: number | null; lng: number | null; acc: number | null } {
  const lat = Number(form.get('lat'))
  const lng = Number(form.get('lng'))
  const acc = Number(form.get('acc'))
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  return ok
    ? { lat: +lat.toFixed(5), lng: +lng.toFixed(5), acc: Number.isFinite(acc) && acc > 0 ? Math.round(acc) : null }
    : { lat: null, lng: null, acc: null }
}

async function wasteStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices,
            COUNT(DISTINCT type) AS types FROM waste_samples`,
  ).first<{ samples: number; devices: number; types: number }>()
  return new Response(
    JSON.stringify({ samples: row?.samples ?? 0, devices: row?.devices ?? 0, types: row?.types ?? 0 }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

/* ------------------------------------------------------------------ *
 * /street — crowd-sourced Cambodia vehicle photos (tuk-tuk, remork,    *
 * cyclo …) for an OFFLINE vehicle classifier, so the /traffic counter  *
 * can count tuk-tuks correctly. Image → R2; type → D1.                 *
 * See docs/SMARTCITY-AI.md.                                            *
 * ------------------------------------------------------------------ */

const STREET_MAX_BYTES = 8 * 1024 * 1024
const STREET_DEVICE_RE = /^t-[0-9a-z]{6,16}$/
// Keep in sync with src/assets/streetLabels.ts (server-side allowlist).
const STREET_TYPES = new Set([
  'tuktuk', 'remork', 'moto_trailer', 'motorbike', 'cyclo', 'bicycle',
  'car', 'pickup', 'van', 'bus', 'truck', 'other',
])

async function serveStreet(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/street/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await streetPostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await streetStats(env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|street_samples/i.test(msg)
      ? 'street storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

// Public: accept one (image, type) sample. multipart/form-data.
async function streetPostSample(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('image') as unknown
  const type = String(form.get('type') ?? '').trim()
  const device = String(form.get('device') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  if (!entry || typeof entry === 'string') return json({ error: 'image required' }, 400)
  const image = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!STREET_TYPES.has(type)) return json({ error: 'bad type' }, 400)
  if (!STREET_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  const size = image.size
  if (!size || size > STREET_MAX_BYTES) return json({ error: 'image too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const t = image.type === 'image/png' ? 'png' : 'jpg'
  const r2Key = `street/${type}/${day}-${id}.${t}`
  await env.MODELS.put(r2Key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/jpeg' },
    customMetadata: { device, type },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const num = (k: string): number | null => {
    const v = Number(form.get(k) ?? 0)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  const geo = parseGeo(form)
  await env.DB.prepare(
    `INSERT INTO street_samples
       (id, r2_key, device, type, note, credit_name, region, lat, lng, acc, width, height, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, type, trim('note', 120), trim('creditName', 60),
    trim('region', 40), geo.lat, geo.lng, geo.acc, num('width'), num('height'), size, now.toISOString(),
  ).run()
  return json({ id })
}

async function streetStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices,
            COUNT(DISTINCT type) AS types FROM street_samples`,
  ).first<{ samples: number; devices: number; types: number }>()
  return new Response(
    JSON.stringify({ samples: row?.samples ?? 0, devices: row?.devices ?? 0, types: row?.types ?? 0 }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

/* ------------------------------------------------------------------ *
 * /species — crowd-sourced biodiversity + mosquito photos for an       *
 * OFFLINE nature-ID classifier (group target; free-text species name + *
 * optional GPS sighting as metadata). See docs/ENVIRONMENT-AI.md.      *
 * ------------------------------------------------------------------ */

const SPECIES_MAX_BYTES = 8 * 1024 * 1024
const SPECIES_DEVICE_RE = /^n-[0-9a-z]{6,16}$/
const SPECIES_GROUPS = new Set([
  'plant', 'bird', 'insect', 'mosquito', 'fish', 'reptile', 'mammal', 'fungus', 'other',
])

async function serveSpecies(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/species/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await speciesPostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await speciesStats(env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|species_samples/i.test(msg)
      ? 'species storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

async function speciesPostSample(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('image') as unknown
  const group = String(form.get('group') ?? '').trim()
  const device = String(form.get('device') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  if (!entry || typeof entry === 'string') return json({ error: 'image required' }, 400)
  const image = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!SPECIES_GROUPS.has(group)) return json({ error: 'bad group' }, 400)
  if (!SPECIES_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  const size = image.size
  if (!size || size > SPECIES_MAX_BYTES) return json({ error: 'image too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const t = image.type === 'image/png' ? 'png' : 'jpg'
  const r2Key = `species/${group}/${day}-${id}.${t}`
  await env.MODELS.put(r2Key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/jpeg' },
    customMetadata: { device, group },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const num = (k: string): number | null => {
    const v = Number(form.get(k) ?? 0)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  const geo = parseGeo(form)
  await env.DB.prepare(
    `INSERT INTO species_samples
       (id, r2_key, device, grp, species, credit_name, region, lat, lng, acc, width, height, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, group, trim('species', 80), trim('creditName', 60), trim('region', 40),
    geo.lat, geo.lng, geo.acc, num('width'), num('height'), size, now.toISOString(),
  ).run()
  return json({ id })
}

async function speciesStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices FROM species_samples`,
  ).first<{ samples: number; devices: number }>()
  return new Response(
    JSON.stringify({ samples: row?.samples ?? 0, devices: row?.devices ?? 0 }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

/* ------------------------------------------------------------------ *
 * /report — geotagged citizen infrastructure / environment reports    *
 * for an OFFLINE report-sorting classifier + a community map dataset.  *
 * Privacy: photograph the ISSUE, not people. See docs/ENVIRONMENT-AI.md*
 * ------------------------------------------------------------------ */

const REPORT_MAX_BYTES = 8 * 1024 * 1024
const REPORT_DEVICE_RE = /^i-[0-9a-z]{6,16}$/
const REPORT_TYPES = new Set([
  'rubbish', 'flooding', 'drainage', 'water_leak', 'pothole', 'streetlight', 'fallen_tree', 'other',
])

async function serveReport(url: URL, request: Request, env: Env): Promise<Response> {
  const path = url.pathname.slice('/api/report/'.length)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type' },
    })
  }
  try {
    if (path === 'sample' && request.method === 'POST') return await reportPostSample(request, env)
    if (path === 'stats' && request.method === 'GET') return await reportStats(env)
    return json({ error: 'not found' }, 404)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const hint = /no such table|report_samples/i.test(msg)
      ? 'report storage not initialised — run the D1 schema migration (worker/schema.sql)'
      : 'server error'
    return json({ error: hint, detail: msg }, 500)
  }
}

async function reportPostSample(request: Request, env: Env): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ error: 'expected multipart form' }, 400)
  }
  const entry = form.get('image') as unknown
  const type = String(form.get('type') ?? '').trim()
  const device = String(form.get('device') ?? '').trim()
  const consent = String(form.get('consent') ?? '') === '1'

  if (!entry || typeof entry === 'string') return json({ error: 'image required' }, 400)
  const image = entry as Blob
  if (!consent) return json({ error: 'consent required' }, 403)
  if (!REPORT_TYPES.has(type)) return json({ error: 'bad type' }, 400)
  if (!REPORT_DEVICE_RE.test(device)) return json({ error: 'bad device id' }, 400)
  const size = image.size
  if (!size || size > REPORT_MAX_BYTES) return json({ error: 'image too large or empty' }, 413)

  const id = crypto.randomUUID()
  const now = new Date()
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const t = image.type === 'image/png' ? 'png' : 'jpg'
  const r2Key = `report/${type}/${day}-${id}.${t}`
  await env.MODELS.put(r2Key, await image.arrayBuffer(), {
    httpMetadata: { contentType: image.type || 'image/jpeg' },
    customMetadata: { device, type },
  })

  const trim = (k: string, max: number): string | null => {
    const v = String(form.get(k) ?? '').trim()
    return v ? v.slice(0, max) : null
  }
  const num = (k: string): number | null => {
    const v = Number(form.get(k) ?? 0)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  const geo = parseGeo(form)
  await env.DB.prepare(
    `INSERT INTO report_samples
       (id, r2_key, device, type, note, credit_name, region, lat, lng, acc, width, height, bytes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, r2Key, device, type, trim('note', 120), trim('creditName', 60), trim('region', 40),
    geo.lat, geo.lng, geo.acc, num('width'), num('height'), size, now.toISOString(),
  ).run()
  return json({ id })
}

async function reportStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS samples, COUNT(DISTINCT device) AS devices FROM report_samples`,
  ).first<{ samples: number; devices: number }>()
  return new Response(
    JSON.stringify({ samples: row?.samples ?? 0, devices: row?.devices ?? 0 }),
    { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=30' } },
  )
}

/* ------------------------------------------------------------------ *
 * Android app download — serves the latest APK uploaded to R2 under   *
 * the apk/ prefix, at /download/* (e.g. /download/iany-android.apk).  *
 * Picks the most recently uploaded .apk so re-uploading a new build   *
 * "just works" with no code change. Supports Range for resumable      *
 * downloads and HEAD for size probes.                                 *
 * ------------------------------------------------------------------ */

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive'
// Preview build — not an official release. Filename reflects that.
const APK_FILENAME = 'iany-android-preview.apk'
// Fallback if the R2 listing is empty/unavailable (the file the user uploaded).
const APK_FALLBACK_KEY = 'apk/application-87aacdb8-848c-4d12-87ea-342899d102d9.apk'

function apkHeaders(size?: number): Headers {
  const h = new Headers({
    'content-type': APK_CONTENT_TYPE,
    // Short cache so a freshly uploaded build propagates quickly.
    'cache-control': 'public, max-age=300',
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
    'content-disposition': `attachment; filename="${APK_FILENAME}"`,
  })
  if (size !== undefined) h.set('content-length', String(size))
  return h
}

async function latestApkKey(env: Env): Promise<string | null> {
  try {
    const listed = await env.MODELS.list({ prefix: 'apk/' })
    let key: string | null = null
    let newest = -Infinity
    for (const o of listed.objects) {
      if (!o.key.toLowerCase().endsWith('.apk')) continue
      const t = o.uploaded ? o.uploaded.getTime() : 0
      if (t >= newest) {
        newest = t
        key = o.key
      }
    }
    return key
  } catch {
    return null
  }
}

async function serveApk(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 })
  }
  const key = (await latestApkKey(env)) ?? APK_FALLBACK_KEY

  if (request.method === 'HEAD') {
    const head = await env.MODELS.head(key)
    if (!head) return new Response('APK not found', { status: 404 })
    return new Response(null, { headers: apkHeaders(head.size) })
  }

  const range = parseRange(request.headers.get('range'))
  if (range) {
    const head = await env.MODELS.head(key)
    if (!head) return new Response('APK not found', { status: 404 })
    const end = Math.min(range.end ?? head.size - 1, head.size - 1)
    if (range.start > end) return new Response('Range not satisfiable', { status: 416 })
    const length = end - range.start + 1
    const obj = await env.MODELS.get(key, { range: { offset: range.start, length } })
    if (!obj) return new Response('APK not found', { status: 404 })
    const headers = apkHeaders(length)
    headers.set('content-range', `bytes ${range.start}-${end}/${head.size}`)
    return new Response(obj.body, { status: 206, headers })
  }

  const obj = await env.MODELS.get(key)
  if (!obj) return new Response('APK not found', { status: 404 })
  return new Response(obj.body, { headers: apkHeaders(obj.size) })
}

// Read-only proxy for Hugging Face model metadata (file lists), so clients in
// regions that can't reach huggingface.co can discover a repo's exact GGUF
// filename instead of guessing. Restricted to `models/{owner}/{repo}`.
const HF_API_RE = /^models\/[\w.-]+\/[\w.-]+$/

async function serveHfApi(url: URL): Promise<Response> {
  const path = url.pathname.slice('/hf-api/'.length)
  if (!HF_API_RE.test(path)) return new Response('Forbidden', { status: 403 })
  const upstream = await fetch(`${HF}/api/${path}`)
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    },
  })
}

async function serveBackup(url: URL, request: Request, env: Env): Promise<Response> {
  const id = url.pathname.slice('/api/backup/'.length)
  if (!BACKUP_ID_RE.test(id)) return new Response('Bad id', { status: 400 })
  const key = `backups/${id}.bin`

  if (request.method === 'PUT') {
    const length = Number(request.headers.get('content-length') ?? 0)
    if (!length || length > BACKUP_MAX_BYTES) {
      return new Response('Payload too large', { status: 413 })
    }
    const body = await request.arrayBuffer()
    if (body.byteLength > BACKUP_MAX_BYTES) {
      return new Response('Payload too large', { status: 413 })
    }
    await env.MODELS.put(key, body, {
      customMetadata: { uploaded: new Date().toISOString() },
    })
    return new Response(null, { status: 204 })
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const obj = await env.MODELS.get(key)
    if (!obj) return new Response('Not found', { status: 404 })
    const headers = new Headers({
      'content-type': 'application/octet-stream',
      'content-length': String(obj.size),
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'cross-origin',
      'x-backup-uploaded': obj.customMetadata?.uploaded ?? '',
    })
    return new Response(request.method === 'HEAD' ? null : obj.body, { headers })
  }

  return new Response('Method not allowed', { status: 405 })
}

function fileHeaders(contentType: string | undefined, size?: number): Headers {
  const headers = new Headers({
    'content-type': contentType ?? 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
    'accept-ranges': 'bytes',
  })
  if (size !== undefined) headers.set('content-length', String(size))
  return headers
}

function parseRange(header: string | null): { start: number; end: number | null } | null {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header ?? '')
  if (!m) return null
  return { start: Number(m[1]), end: m[2] ? Number(m[2]) : null }
}

/** Fetch a file from Hugging Face into R2 (synchronous — resolves once the
 *  object is fully stored). Returns false when the file can't be cached
 *  (e.g. unknown length), in which case callers should proxy directly. */
async function primeFromUpstream(key: string, hfPath: string, env: Env): Promise<boolean> {
  const upstream = await fetch(upstreamUrl(key, hfPath))
  if (!upstream.ok || !upstream.body) return false
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
  const length = Number(upstream.headers.get('content-length') ?? 0)
  if (!length) return false
  if (length <= BUFFER_LIMIT) {
    await env.MODELS.put(key, await upstream.arrayBuffer(), { httpMetadata: { contentType } })
  } else {
    await env.MODELS.put(key, upstream.body.pipeThrough(new FixedLengthStream(length)), {
      httpMetadata: { contentType },
    })
  }
  return true
}

async function serveModel(
  url: URL,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Transformers.js requests /models/{model-id}/resolve/{revision}/{file};
  // R2 keys drop the resolve segment: {model-id}/{file}
  const hfPath = url.pathname.slice('/models/'.length)
  const key = hfPath.replace(/\/resolve\/[^/]+\//, '/')
  if (!isAllowedKey(key)) {
    return new Response('Forbidden', { status: 403 })
  }

  // HEAD: report size/type without pulling anything. Serves the resumable
  // downloader's probe cheaply whether or not the file is in R2 yet.
  if (request.method === 'HEAD') {
    const head = await env.MODELS.head(key)
    if (head) {
      return new Response(null, { headers: fileHeaders(head.httpMetadata?.contentType, head.size) })
    }
    const upstream = await fetch(upstreamUrl(key, hfPath), { method: 'HEAD' })
    if (!upstream.ok) return new Response(`Upstream ${upstream.status}`, { status: 502 })
    const len = Number(upstream.headers.get('content-length') ?? 0)
    return new Response(null, {
      headers: fileHeaders(
        upstream.headers.get('content-type') ?? undefined,
        len > 0 ? len : undefined,
      ),
    })
  }

  // Range: resumable chunk download. Ensure the object is in R2 first
  // (one synchronous pull), then serve every range from R2.
  const range = parseRange(request.headers.get('range'))
  if (range) {
    let head = await env.MODELS.head(key)
    if (!head) {
      if (!(await primeFromUpstream(key, hfPath, env))) {
        // Can't cache (unknown length): proxy the range straight to HF.
        return fetch(upstreamUrl(key, hfPath), { headers: { range: request.headers.get('range')! } })
      }
      head = await env.MODELS.head(key)
      if (!head) return new Response('Prime failed', { status: 502 })
    }
    const end = Math.min(range.end ?? head.size - 1, head.size - 1)
    if (range.start > end) return new Response('Range not satisfiable', { status: 416 })
    const length = end - range.start + 1
    const obj = await env.MODELS.get(key, { range: { offset: range.start, length } })
    if (!obj) return new Response('Not found', { status: 404 })
    const headers = fileHeaders(obj.httpMetadata?.contentType, length)
    headers.set('content-range', `bytes ${range.start}-${end}/${head.size}`)
    return new Response(obj.body, { status: 206, headers })
  }

  const cached = await env.MODELS.get(key)
  if (cached) {
    return new Response(cached.body, { headers: fileHeaders(cached.httpMetadata?.contentType, cached.size) })
  }

  const upstream = await fetch(upstreamUrl(key, hfPath))
  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream ${upstream.status}`, { status: 502 })
  }
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
  const length = Number(upstream.headers.get('content-length') ?? 0)

  if (length > 0 && length <= BUFFER_LIMIT) {
    const buf = await upstream.arrayBuffer()
    ctx.waitUntil(env.MODELS.put(key, buf, { httpMetadata: { contentType } }))
    return new Response(buf, { headers: fileHeaders(contentType, buf.byteLength) })
  }

  if (length > 0) {
    // Large weight files: stream to the client and into R2 simultaneously.
    const [toStore, toClient] = upstream.body.tee()
    ctx.waitUntil(
      env.MODELS.put(key, toStore.pipeThrough(new FixedLengthStream(length)), {
        httpMetadata: { contentType },
      }),
    )
    return new Response(toClient, { headers: fileHeaders(contentType, length) })
  }

  // Unknown length: pass through without caching.
  return new Response(upstream.body, { headers: fileHeaders(contentType) })
}
