import type { ObjectDetector } from '@mediapipe/tasks-vision'

// `@mediapipe/tasks-vision` is imported DYNAMICALLY inside ensure() so the ~125 KB
// vision runtime is a lazy chunk — it only loads when the traffic view runs.

/**
 * On-device traffic object detector for the /traffic smart-city view. Wraps
 * MediaPipe's Object Detector (EfficientDet-Lite, COCO, Apache-2.0) in VIDEO mode
 * to detect and count vehicles + people in a live camera frame — fully offline
 * after the ~4.6 MB model downloads once.
 *
 * Honest limit: COCO has no "tuktuk / remork" class — a tuktuk is usually detected
 * as `car` or `motorbike`. A Cambodia-specific detector (future, from a street-scene
 * dataset) would distinguish local vehicles. See docs/SMARTCITY-AI.md.
 */
export interface Detection {
  label: string // person / bicycle / car / motorbike / bus / truck
  score: number
  x: number
  y: number
  w: number
  h: number
}

// COCO classes we keep, mapped to friendly labels.
const KEEP: Record<string, string> = {
  person: 'person',
  bicycle: 'bicycle',
  car: 'car',
  motorcycle: 'motorbike',
  bus: 'bus',
  truck: 'truck',
}

export interface TrafficDetector {
  prepare(onProgress?: (f: number) => void): Promise<void>
  detect(video: HTMLVideoElement, timestampMs: number): Detection[]
  close(): void
}

export function createTrafficDetector(opts: { wasmPath: string; modelUrl: string }): TrafficDetector {
  let detector: ObjectDetector | null = null
  let loading: Promise<ObjectDetector> | null = null

  async function ensure(onProgress?: (f: number) => void): Promise<ObjectDetector> {
    if (detector) return detector
    if (!loading) {
      loading = (async () => {
        onProgress?.(0.02)
        const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision')
        onProgress?.(0.05)
        const fileset = await FilesetResolver.forVisionTasks(opts.wasmPath)
        const buf = await fetchWithProgress(opts.modelUrl, (f) => onProgress?.(0.05 + 0.9 * f))
        const bytes = new Uint8Array(buf)
        const make = (delegate: 'GPU' | 'CPU') =>
          ObjectDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetBuffer: bytes, delegate },
            runningMode: 'VIDEO',
            scoreThreshold: 0.4,
            maxResults: 40,
          })
        // Prefer GPU (smooth live video); fall back to CPU where the GPU
        // delegate is unavailable (some phones / browsers) so it still works.
        let d: ObjectDetector
        try {
          d = await make('GPU')
        } catch {
          d = await make('CPU')
        }
        detector = d
        onProgress?.(1)
        return d
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
    detect(video, timestampMs) {
      if (!detector) return []
      let res
      try {
        res = detector.detectForVideo(video, timestampMs)
      } catch {
        // A bad frame / non-monotonic timestamp must not kill the render loop.
        return []
      }
      const out: Detection[] = []
      for (const det of res.detections ?? []) {
        const cat = det.categories?.[0]
        const name = cat?.categoryName ?? ''
        const label = KEEP[name]
        const bb = det.boundingBox
        if (!label || !cat || !bb) continue
        out.push({ label, score: cat.score, x: bb.originX, y: bb.originY, w: bb.width, h: bb.height })
      }
      return out
    },
    close() {
      try {
        detector?.close()
      } catch {
        /* ignore */
      }
      detector = null
      loading = null
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
