import type { Classification } from './imageClassifier'
import type { LiveClassifier } from '../views/LiveCapture'

/**
 * On-device waste classifier — the real model (trained from open datasets, see
 * docs/WASTE-MODEL.md) run via onnxruntime-web, the same runtime the OCR/STT use.
 * MobileNetV2, 224×224, output = softmax over our material types (the model's
 * labels ARE the /waste type ids). Replaces the beta ImageNet guess.
 *
 * `onnxruntime-web` is imported DYNAMICALLY so its ~1 MB runtime is a lazy chunk —
 * it only loads when the live camera opens. Forced to a single WASM thread so it
 * loads even where the page isn't cross-origin isolated (SharedArrayBuffer absent);
 * a tiny model at a few fps doesn't need threads.
 */
const SIZE = 224

export function createWasteClassifier(opts: { modelUrl: string; labels: string[] }): LiveClassifier {
  let session: import('onnxruntime-web').InferenceSession | null = null
  let ort: typeof import('onnxruntime-web') | null = null
  let loading: Promise<void> | null = null
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  async function ensure(onProgress?: (f: number) => void): Promise<void> {
    if (session) return
    if (!loading) {
      loading = (async () => {
        onProgress?.(0.02)
        ort = await import('onnxruntime-web')
        ort.env.wasm.wasmPaths = `${location.origin}/ort/`
        ort.env.wasm.numThreads = 1 // load without cross-origin isolation
        const bytes = await fetchWithProgress(opts.modelUrl, (f) => onProgress?.(0.05 + 0.9 * f))
        session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
        onProgress?.(1)
      })().catch((e) => {
        loading = null
        throw e
      })
    }
    await loading
  }

  return {
    async prepare(onProgress) {
      await ensure(onProgress)
    },
    async classifyFrame(video) {
      if (!session || !ort) return []
      // Centre-crop the frame to a square, then 224×224, so the item isn't squashed.
      const vw = video.videoWidth
      const vh = video.videoHeight
      if (!vw || !vh) return []
      const s = Math.min(vw, vh)
      ctx.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, SIZE, SIZE)
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
      // RGBA[0,255] → RGB[-1,1], NHWC (matches MobileNetV2 preprocess_input).
      const buf = new Float32Array(SIZE * SIZE * 3)
      for (let i = 0, j = 0; i < data.length; i += 4) {
        buf[j++] = data[i]! / 127.5 - 1
        buf[j++] = data[i + 1]! / 127.5 - 1
        buf[j++] = data[i + 2]! / 127.5 - 1
      }
      const input = new ort.Tensor('float32', buf, [1, SIZE, SIZE, 3])
      const out = await session.run({ [session.inputNames[0]]: input })
      const probs = out[session.outputNames[0]!]!.data as Float32Array
      const res: Classification[] = opts.labels.map((label, i) => ({ label, score: probs[i] ?? 0 }))
      res.sort((a, b) => b.score - a.score)
      return res
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
