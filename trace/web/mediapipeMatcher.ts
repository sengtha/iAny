import type { ImageEmbedder } from '@mediapipe/tasks-vision'
import type { MatcherAdapter } from './adapters'

// `@mediapipe/tasks-vision` is imported DYNAMICALLY inside ensure() (below), so
// the ~125 KB vision runtime is a lazy chunk — it only loads when the user turns
// "better matching" on. The Trace page's initial load stays light and offline.

/**
 * A `MatcherAdapter` backed by MediaPipe's Image Embedder (Apache-2.0). Produces
 * an L2-normalized MobileNet embedding per photo, giving Trace a sharper, more
 * lighting/angle-robust appearance match than the classical descriptor.
 *
 * Optional + lazy: nothing loads until the user turns "Better matching" on, and
 * the classical path keeps working with no model. Depends on
 * `@mediapipe/tasks-vision`; a host that doesn't want that dependency simply
 * doesn't import this file (the Trace core + rest of the UI stay model-free).
 *
 * @param wasmPath  where the MediaPipe vision WASM lives (e.g. `${origin}/mediapipe`)
 * @param modelUrl  the `.tflite` embedder (served through the app's model mirror)
 */
export function createMediapipeMatcher(opts: {
  wasmPath: string
  modelUrl: string
  label?: string
  sizeMb?: number
}): MatcherAdapter {
  let embedder: ImageEmbedder | null = null
  let loading: Promise<ImageEmbedder> | null = null

  async function ensure(onProgress?: (f: number) => void): Promise<ImageEmbedder> {
    if (embedder) return embedder
    if (!loading) {
      loading = (async () => {
        onProgress?.(0.02)
        const { FilesetResolver, ImageEmbedder } = await import('@mediapipe/tasks-vision')
        onProgress?.(0.05)
        const fileset = await FilesetResolver.forVisionTasks(opts.wasmPath)
        // Fetch the model ourselves so we can report real download progress, then
        // hand the bytes to MediaPipe (also lets the browser/model-mirror cache it).
        const buf = await fetchWithProgress(opts.modelUrl, (f) => onProgress?.(0.05 + 0.9 * f))
        const e = await ImageEmbedder.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: new Uint8Array(buf), delegate: 'GPU' },
          quantize: false,
          l2Normalize: true, // so cosine == dot product, matching the core's cosine()
        })
        embedder = e
        onProgress?.(1)
        return e
      })().catch((err) => {
        loading = null // allow a retry after a failed load
        throw err
      })
    }
    return loading
  }

  return {
    label: opts.label ?? 'Better matching',
    sizeMb: opts.sizeMb,
    async prepare(onProgress) {
      await ensure(onProgress)
    },
    async embed(blob) {
      try {
        const e = await ensure()
        const bmp = await createImageBitmap(blob)
        const res = e.embed(bmp)
        bmp.close()
        const v = res.embeddings?.[0]?.floatEmbedding
        return v && v.length ? Array.from(v) : null
      } catch {
        return null // fall back to the classical descriptor
      }
    },
  }
}

async function fetchWithProgress(url: string, onProgress?: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`)
  const total = Number(res.headers.get('content-length') ?? 0)
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
  const out = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out.buffer
}
