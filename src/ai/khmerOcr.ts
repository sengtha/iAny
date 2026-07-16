import type { OcrImage } from '@iany/core'

/**
 * Khmer OCR in the browser — reads Khmer (and Latin) text out of a photo or a
 * scanned page using seanghay's KhmerOCR ONNX models (MIT): a YOLO-style text
 * detector + a CRNN/CTC recognizer. Fully offline once the ~25 MB of models are
 * downloaded (kept in the Cache API). Inference runs in a Web Worker so a busy
 * page never freezes the UI; the main thread only decodes the image.
 */

const OCR_BASE = '/models/sengtha/khmer-ocr/resolve/main'
const DET_URL = `${OCR_BASE}/det.onnx`
const REC_URL = `${OCR_BASE}/rec.onnx`
const OCR_CACHE = 'iany-ocr-v1'
// Cap the decoded image so a 12-megapixel phone photo doesn't blow memory on a
// low-end device; the detector works at 1024 px and this keeps text legible.
const MAX_SIDE = 2048

export type OcrStatus = 'off' | 'downloading' | 'loading' | 'ready' | 'error'
export interface OcrProgress {
  status: OcrStatus
  progress?: number
  error?: string
}

class KhmerOcr {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (e: Error) => void; onLine?: (done: number, total: number) => void }
  >()
  status: OcrStatus = 'off'

  get ready(): boolean {
    return this.status === 'ready' && this.worker !== null
  }

  async isDownloaded(): Promise<boolean> {
    const c = await openCache()
    if (!c) return false
    return (await c.match(DET_URL).catch(() => undefined)) != null
  }

  /** Download (once) + load both models into the worker. */
  async init(onProgress?: (p: OcrProgress) => void): Promise<void> {
    if (this.ready) return
    try {
      this.status = 'downloading'
      onProgress?.({ status: 'downloading', progress: 0 })
      // Two files; weight progress by their rough share so the bar is smooth.
      const detBytes = await fetchCached(DET_URL, (f) => onProgress?.({ status: 'downloading', progress: f * 0.45 }))
      const recBytes = await fetchCached(REC_URL, (f) => onProgress?.({ status: 'downloading', progress: 0.45 + f * 0.55 }))
      this.status = 'loading'
      onProgress?.({ status: 'loading' })
      await this.startWorker(detBytes, recBytes)
      this.status = 'ready'
      onProgress?.({ status: 'ready' })
    } catch (e) {
      this.status = 'error'
      onProgress?.({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  /** OCR one image file → recognized text (one line per detected text line). */
  async recognizeImage(
    file: Blob,
    onProgress?: (p: OcrProgress & { line?: { done: number; total: number } }) => void,
  ): Promise<string> {
    if (!this.ready) await this.init(onProgress)
    const img = await decodeToRgba(file)
    return new Promise<string>((resolve, reject) => {
      const id = ++this.seq
      this.pending.set(id, {
        resolve,
        reject,
        onLine: (done, total) => onProgress?.({ status: 'ready', line: { done, total } }),
      })
      const buf = (img.data as Uint8Array).buffer as ArrayBuffer
      this.worker!.postMessage(
        { type: 'recognize', id, rgba: buf, width: img.width, height: img.height },
        [buf],
      )
    })
  }

  private startWorker(det: Uint8Array, rec: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./khmerocr.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as
          | { type: 'ready' }
          | { type: 'progress'; id: number; done: number; total: number }
          | { type: 'result'; id: number; text: string }
          | { type: 'error'; id?: number; error: string }
        if (m.type === 'ready') {
          this.worker = w
          resolve()
        } else if (m.type === 'progress') {
          this.pending.get(m.id)?.onLine?.(m.done, m.total)
        } else if (m.type === 'result') {
          this.pending.get(m.id)?.resolve(m.text)
          this.pending.delete(m.id)
        } else if (m.type === 'error') {
          if (m.id != null && this.pending.has(m.id)) {
            this.pending.get(m.id)!.reject(new Error(m.error))
            this.pending.delete(m.id)
          } else {
            reject(new Error(m.error))
          }
        }
      }
      w.onerror = (ev) => reject(new Error(ev.message || 'OCR worker failed to start'))
      const d = det.buffer as ArrayBuffer
      const r = rec.buffer as ArrayBuffer
      w.postMessage({ type: 'init', det: d, rec: r }, [d, r])
    })
  }
}

/** Decode an image Blob to RGBA, downscaling very large photos to MAX_SIDE. */
async function decodeToRgba(file: Blob): Promise<OcrImage> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const cx = canvas.getContext('2d')!
  cx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const id = cx.getImageData(0, 0, w, h)
  return { data: new Uint8Array(id.data.buffer.slice(0)), width: w, height: h }
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    return await caches.open(OCR_CACHE)
  } catch {
    return null
  }
}

/** Fetch a model file, using the Cache API when available (offline reuse). */
async function fetchCached(url: string, onProgress: (f: number) => void): Promise<Uint8Array> {
  const cache = await openCache()
  if (cache) {
    const hit = await cache.match(url).catch(() => undefined)
    if (hit) {
      onProgress(1)
      return new Uint8Array(await hit.arrayBuffer())
    }
  }
  const net = await fetch(url)
  if (!net.ok || !net.body) throw new Error(`OCR model download failed (${net.status})`)
  const total = Number(net.headers.get('content-length') || 0)
  const reader = net.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) onProgress(received / total)
  }
  const blob = new Blob(chunks as BlobPart[])
  if (cache) await cache.put(url, new Response(blob)).catch(() => {})
  return new Uint8Array(await blob.arrayBuffer())
}

export const khmerOcr = new KhmerOcr()
