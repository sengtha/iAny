/**
 * Resumable model downloads.
 *
 * Large files are fetched in 8 MB Range chunks; every completed chunk is
 * stored durably in the Cache API immediately. If the download is
 * interrupted — network drop, closed tab, phone sleep — the next attempt
 * resumes from the last saved chunk instead of starting over. Installed as
 * a fetch wrapper in the AI worker so it is transparent to Transformers.js
 * (which sees one complete response and caches it as usual).
 */

const PARTIAL_CACHE = 'iany-partials'
const CHUNK_BYTES = 8 * 1024 * 1024
/** Below this, a plain fetch is cheaper than chunk bookkeeping. */
const THRESHOLD_BYTES = 20 * 1024 * 1024
const CHUNK_RETRIES = 3

export type ProgressReport = (url: string, loaded: number, total: number) => void

type FetchFn = typeof fetch

/** Synthetic cache key per chunk (never actually fetched; fragments are
 *  stripped by the Cache API, so a query parameter carries the index). */
function chunkKey(url: string, index: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}iany_chunk=${index}`
}

async function fetchChunk(
  origFetch: FetchFn,
  url: string,
  from: number,
  to: number,
): Promise<Blob> {
  let lastError: unknown
  for (let attempt = 0; attempt < CHUNK_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    try {
      const res = await origFetch(url, { headers: { range: `bytes=${from}-${to}` } })
      if (res.status !== 206) throw new Error(`range not honored: HTTP ${res.status}`)
      const blob = await res.blob()
      if (blob.size !== to - from + 1) {
        throw new Error(`chunk size mismatch: ${blob.size} != ${to - from + 1}`)
      }
      return blob
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function resumableFetch(
  url: string,
  origFetch: FetchFn,
  report: ProgressReport,
): Promise<Response> {
  const head = await origFetch(url, { method: 'HEAD' })
  if (!head.ok) return origFetch(url) // let the caller observe the real error
  const total = Number(head.headers.get('content-length') ?? 0)
  const contentType = head.headers.get('content-type') ?? 'application/octet-stream'
  const supportsRanges = (head.headers.get('accept-ranges') ?? '').includes('bytes')
  if (!total || total <= THRESHOLD_BYTES || !supportsRanges) return origFetch(url)

  const cache = await caches.open(PARTIAL_CACHE)
  const chunkCount = Math.ceil(total / CHUNK_BYTES)
  const parts: Blob[] = []

  // Resume point: chunks are downloaded sequentially, so saved chunks form
  // a contiguous prefix.
  let next = 0
  for (; next < chunkCount; next++) {
    const saved = await cache.match(chunkKey(url, next))
    if (!saved) break
    parts.push(await saved.blob())
  }
  report(url, Math.min(next * CHUNK_BYTES, total), total)

  for (let i = next; i < chunkCount; i++) {
    const from = i * CHUNK_BYTES
    const to = Math.min(total, from + CHUNK_BYTES) - 1
    const blob = await fetchChunk(origFetch, url, from, to)
    await cache.put(chunkKey(url, i), new Response(blob))
    parts.push(blob)
    report(url, Math.min((i + 1) * CHUNK_BYTES, total), total)
  }

  const body = new Blob(parts, { type: contentType })
  // Partials are no longer needed; the assembled blob holds its own refs.
  void (async () => {
    for (let i = 0; i < chunkCount; i++) await cache.delete(chunkKey(url, i))
  })()

  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': String(total) },
  })
}

/** Delete leftover partial chunks that don't belong to any of the given
 *  models (e.g. an abandoned download of a model the user switched away
 *  from). Stale partials silently eat the storage quota and can prevent
 *  the browser from persisting newly downloaded models. */
export async function purgeStalePartials(keepModelIds: string[]): Promise<void> {
  try {
    const cache = await caches.open(PARTIAL_CACHE)
    for (const req of await cache.keys()) {
      if (!keepModelIds.some((id) => req.url.includes(`${id}/`))) {
        await cache.delete(req)
      }
    }
  } catch {
    // Cache API unavailable — nothing to purge.
  }
}

/** Build a fetch that makes matching GET requests resumable. Install it as
 *  Transformers.js `env.fetch` — the library routes ALL model downloads
 *  through that hook and never touches the global fetch. Requests that
 *  already carry a Range header (metadata probes) pass through untouched. */
export function createResumableFetch(
  shouldIntercept: (url: string) => boolean,
  report: ProgressReport,
): typeof fetch {
  const origFetch = self.fetch.bind(self)
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    if (method === 'GET' && !headers.has('range') && shouldIntercept(url)) {
      return resumableFetch(url, origFetch, report)
    }
    return origFetch(input as RequestInfo, init)
  }) as typeof fetch
}
