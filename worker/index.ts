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
]
// Below this size, buffer instead of streaming: small JSON/tokenizer files
// may arrive compressed (content-length != stream length), which breaks
// FixedLengthStream-based R2 puts.
const BUFFER_LIMIT = 10 * 1024 * 1024

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/models/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 })
      }
      return serveModel(url, request, env, ctx)
    }
    return env.ASSETS.fetch(request)
  },
}

function fileHeaders(contentType: string | undefined, size?: number): Headers {
  const headers = new Headers({
    'content-type': contentType ?? 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
    'access-control-allow-origin': '*',
  })
  if (size !== undefined) headers.set('content-length', String(size))
  return headers
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

  const cached = await env.MODELS.get(key)
  if (cached) {
    if (request.method === 'HEAD') {
      return new Response(null, { headers: fileHeaders(cached.httpMetadata?.contentType, cached.size) })
    }
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
    return new Response(request.method === 'HEAD' ? null : buf, {
      headers: fileHeaders(contentType, buf.byteLength),
    })
  }

  if (length > 0) {
    // Large weight files: stream to the client and into R2 simultaneously.
    const [toStore, toClient] = upstream.body.tee()
    ctx.waitUntil(
      env.MODELS.put(key, toStore.pipeThrough(new FixedLengthStream(length)), {
        httpMetadata: { contentType },
      }),
    )
    return new Response(request.method === 'HEAD' ? null : toClient, {
      headers: fileHeaders(contentType, length),
    })
  }

  // Unknown length: pass through without caching.
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    headers: fileHeaders(contentType),
  })
}
