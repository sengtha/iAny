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
const TESSDATA_BEST = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main'
const TESSDATA_FAST = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main'
// Only mirror the models iAny actually uses — this endpoint must not be an
// open proxy.
const ALLOWED_PREFIXES = [
  'onnx-community/embeddinggemma-300m-ONNX/',
  'onnx-community/gemma-4-E2B-it-ONNX/',
  'onnx-community/gemma-3-1b-it-ONNX-GQA/',
  'onnx-community/gemma-3-270m-it-ONNX/',
  'onnx-community/gemma-4-E4B-it-ONNX/',
  'onnx-community/Qwen3-0.6B-ONNX/',
  'sengtha/iany-khmer-tiny-v1-ONNX/',
  // Native app (llama.rn) embedding model — GGUF served through this mirror
  // so devices in regions that can't reach huggingface.co still get it.
  // EmbeddingGemma matches the PWA (portable packs) and handles Khmer well.
  'ggml-org/embeddinggemma-300M-GGUF/',
  'cstr/multilingual-e5-small-GGUF/',
  // Native app (llama.rn) generation models — Gemma 3, GGUF. 270M fits weak
  // phones (S10); 1B for capable devices.
  'ggml-org/gemma-3-1b-it-GGUF/',
  'bartowski/google_gemma-3-270m-it-GGUF/',
  // iAny's own Khmer fine-tune (Gemma 3 270M), converted to GGUF — the real
  // S10 generation model.
  'sengtha/iany-khmer-tiny-v1-Q8_0-GGUF/',
  // Small-vocab diagnostic (SmolLM2, ~49k vocab vs Gemma's 262k) to test
  // whether Gemma's vocabulary is what blocks generation on the S10.
  'bartowski/SmolLM2-135M-Instruct-GGUF/',
  // Medium-vocab multilingual (Qwen2.5-0.5B, ~152k vocab) — smaller logits
  // buffer than Gemma, some Khmer; candidate S10 generation model.
  'bartowski/Qwen2.5-0.5B-Instruct-GGUF/',
  // The S10 Khmer model: Qwen3 0.6B trimmed to a 32k Khmer vocab (tiny logits
  // buffer, Khmer-trained, non-Gemma). Converted from alphaedge-ai's model.
  'sengtha/Qwen3-0.6B-khm-32768-Q8_0-GGUF/',
  // Fine-tuned on iAny's Khmer corpus (CPT on FineWeb-2 + ParaCrawl) for better
  // Khmer — same 32k vocab so it still fits the S10.
  'sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF/',
  // + Q&A SFT (Stage B) on sengtha/khmer-qa -> answers correctly. Current model.
  'sengtha/Qwen3-0.6B-khm-ft2-Q8_0-GGUF/',
  // On-device Khmer TTS: VITS voice (trained on DDD-Cambodia 727h) as ONNX +
  // tts_meta.json (grapheme vocab). Runs via onnxruntime-react-native, offline.
  'sengtha/khmer-tts-female-v1/',
  // Limit test: bigger base Qwen3 (1.7B, full vocab) to probe the S10 ceiling.
  'unsloth/Qwen3-1.7B-GGUF/',
]
// OCR language data, served through the same mirror. Khmer uses the
// high-accuracy models; English's fast model is accurate enough.
const TESSDATA_RE = /^tessdata2\/(khm|eng)\.traineddata$/

function isAllowedKey(key: string): boolean {
  return ALLOWED_PREFIXES.some((p) => key.startsWith(p)) || TESSDATA_RE.test(key)
}

function upstreamUrl(key: string, hfPath: string): string {
  if (key.startsWith('tessdata2/')) {
    const file = key.slice('tessdata2/'.length)
    return `${file.startsWith('khm') ? TESSDATA_BEST : TESSDATA_FAST}/${file}`
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
    // Static assets: cross-origin isolation headers come from public/_headers
    // (asset requests bypass this worker via run_worker_first). That
    // isolation lets onnxruntime-web use multiple WASM threads — 2-4x faster
    // CPU inference on phones. Worker-served model/backup responses carry a
    // matching CORP header (see fileHeaders / serveBackup).
    return env.ASSETS.fetch(request)
  },
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
