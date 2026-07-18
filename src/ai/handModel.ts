/**
 * Pre-download helper for the MediaPipe hand-tracking model that powers the
 * Khmer Sign Language collector (/sign).
 *
 * The /sign page loads `hand_landmarker.task` on first use, but people often
 * open it in a classroom with a weak connection. This lets them fetch it ahead
 * of time from the Models screen so /sign works offline. The file is served
 * through the same /models mirror as every other iAny model and cached in a
 * dedicated Cache Storage bucket; MediaPipe's own fetch on /sign is served from
 * the service worker's runtime cache (see vite.config.ts runtimeCaching).
 */

const CACHE = 'iany-hand-model'
const READY_KEY = 'iany.hand.downloaded'
export const HAND_MODEL_URL =
  (typeof localStorage !== 'undefined' && localStorage.getItem('iany.handModel')) ||
  `${location.origin}/models/sengtha/mediapipe-hand/resolve/main/hand_landmarker.task`

/**
 * Can this device run the hand tracker? Checks camera + WebAssembly only, so it
 * has NO dependency on the (heavy) MediaPipe module — the Models screen can call
 * it without pulling ~130 KB of tracker code into the main app's initial load.
 */
export function isHandTrackingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof WebAssembly !== 'undefined'
  )
}

/** Has the hand model been fetched into the browser cache on this device? */
export async function isHandModelDownloaded(): Promise<boolean> {
  try {
    if (localStorage.getItem(READY_KEY) === '1') return true
  } catch {
    /* ignore */
  }
  if (typeof caches === 'undefined') return false
  try {
    const c = await caches.open(CACHE)
    return !!(await c.match(HAND_MODEL_URL))
  } catch {
    return false
  }
}

/** Fetch the model (with progress) and store it for offline use. */
export async function downloadHandModel(onProgress?: (fraction: number) => void): Promise<void> {
  const res = await fetch(HAND_MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)

  const total = Number(res.headers.get('content-length') ?? 0)
  // Read the stream so we can report progress; buffer to store a complete copy.
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
      if (total > 0) onProgress?.(Math.min(1, received / total))
    }
  }
  const blob = new Blob(chunks, { type: 'application/octet-stream' })

  if (typeof caches !== 'undefined') {
    const c = await caches.open(CACHE)
    await c.put(HAND_MODEL_URL, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }))
  }
  try {
    localStorage.setItem(READY_KEY, '1')
  } catch {
    /* private mode */
  }
  onProgress?.(1)
}

/** Remove the cached model (for "redownload"/delete). */
export async function clearHandModel(): Promise<void> {
  try {
    localStorage.removeItem(READY_KEY)
  } catch {
    /* ignore */
  }
  if (typeof caches !== 'undefined') {
    try {
      await caches.delete(CACHE)
    } catch {
      /* ignore */
    }
    // Also drop any copy the service worker's runtime cache picked up.
    for (const name of await caches.keys()) {
      const c = await caches.open(name)
      for (const req of await c.keys()) {
        if (req.url.includes('mediapipe-hand')) await c.delete(req)
      }
    }
  }
}
