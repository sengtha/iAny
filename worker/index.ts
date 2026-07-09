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

interface Env {
  MODELS: R2Bucket
  ASSETS: Fetcher
}

const HF = 'https://huggingface.co'
// Only mirror the models iAny actually uses — this endpoint must not be an
// open proxy into Hugging Face.
const ALLOWED_PREFIXES = [
  'onnx-community/embeddinggemma-300m-ONNX/',
  'onnx-community/gemma-4-E2B-it-ONNX/',
  'onnx-community/gemma-3-1b-it-ONNX-GQA/',
  'onnx-community/gemma-3-270m-it-ONNX/',
  'onnx-community/gemma-4-E4B-it-ONNX/',
]
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
    return env.ASSETS.fetch(request)
  },
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
  const upstream = await fetch(`${HF}/${hfPath}`)
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
  if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
    return new Response('Forbidden', { status: 403 })
  }

  // HEAD: report size/type without pulling anything. Serves the resumable
  // downloader's probe cheaply whether or not the file is in R2 yet.
  if (request.method === 'HEAD') {
    const head = await env.MODELS.head(key)
    if (head) {
      return new Response(null, { headers: fileHeaders(head.httpMetadata?.contentType, head.size) })
    }
    const upstream = await fetch(`${HF}/${hfPath}`, { method: 'HEAD' })
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
        return fetch(`${HF}/${hfPath}`, { headers: { range: request.headers.get('range')! } })
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

  const upstream = await fetch(`${HF}/${hfPath}`)
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
