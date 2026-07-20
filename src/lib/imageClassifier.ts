import type { ImageClassifier } from '@mediapipe/tasks-vision'

// `@mediapipe/tasks-vision` is imported DYNAMICALLY inside ensure() so the ~125 KB
// vision runtime is a lazy chunk — it only loads when a classifier is actually used.

/**
 * A generic on-device image classifier backed by MediaPipe's ImageClassifier
 * (Apache-2.0). Point it at any `.tflite` classifier exported by MediaPipe Model
 * Maker (see docs/VISION-MOBILENET.md) — e.g. a crop-health model trained from the
 * open /crop dataset — and it runs fully offline on the phone.
 *
 * This is the deploy half of the vision pipeline: /crop collects the data →
 * MobileNetV3 is fine-tuned → export `.tflite` → mirror it → load it here → speak
 * the result with the on-device Khmer TTS. Lazy: the runtime + model only load on
 * first use.
 *
 * @param wasmPath  where the MediaPipe vision WASM lives (e.g. `${origin}/mediapipe`)
 * @param modelUrl  the `.tflite` classifier (served through the app's model mirror)
 */
export interface Classification {
  /** Label id from the model (e.g. "cassava_disease"). */
  label: string
  /** Confidence 0..1. */
  score: number
}

export interface ImageClassifierAdapter {
  /** Load the model lazily (may download on first call). Reports 0..1 progress. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>
  /** Top-`k` predictions for a photo, highest score first (empty if it failed). */
  classify(blob: Blob, k?: number): Promise<Classification[]>
}

export function createImageClassifier(opts: {
  wasmPath: string
  modelUrl: string
  maxResults?: number
}): ImageClassifierAdapter {
  let classifier: ImageClassifier | null = null
  let loading: Promise<ImageClassifier> | null = null

  async function ensure(onProgress?: (f: number) => void): Promise<ImageClassifier> {
    if (classifier) return classifier
    if (!loading) {
      loading = (async () => {
        onProgress?.(0.02)
        const { FilesetResolver, ImageClassifier } = await import('@mediapipe/tasks-vision')
        onProgress?.(0.05)
        const fileset = await FilesetResolver.forVisionTasks(opts.wasmPath)
        const buf = await fetchWithProgress(opts.modelUrl, (f) => onProgress?.(0.05 + 0.9 * f))
        const c = await ImageClassifier.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: new Uint8Array(buf), delegate: 'GPU' },
          maxResults: opts.maxResults ?? 3,
        })
        classifier = c
        onProgress?.(1)
        return c
      })().catch((err) => {
        loading = null
        throw err
      })
    }
    return loading
  }

  return {
    async prepare(onProgress) {
      await ensure(onProgress)
    },
    async classify(blob, k) {
      try {
        const c = await ensure()
        const bmp = await createImageBitmap(blob)
        const res = c.classify(bmp)
        bmp.close()
        const cats = res.classifications?.[0]?.categories ?? []
        return cats
          .slice(0, k ?? cats.length)
          .map((cat) => ({ label: cat.categoryName || cat.displayName || String(cat.index), score: cat.score }))
      } catch {
        return []
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
