/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'
import {
  buildDetInput,
  parseDetections,
  sortIntoLines,
  buildRecInput,
  ctcDecode,
  DET_SIZE,
  REC_HEIGHT,
  type OcrImage,
} from '@iany/core'

/**
 * Khmer OCR inference worker: runs the detector + recognizer ONNX off the main
 * thread (onnxruntime-web wasm compute is synchronous). The main thread decodes
 * the image to RGBA and sends it in; the worker returns the recognized text.
 */
let det: ort.InferenceSession | null = null
let rec: ort.InferenceSession | null = null

type InMsg =
  | { type: 'init'; det: ArrayBuffer; rec: ArrayBuffer }
  | { type: 'recognize'; id: number; rgba: ArrayBuffer; width: number; height: number }

const post = (m: unknown, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(m, transfer ?? [])

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as InMsg
  try {
    if (msg.type === 'init') {
      ort.env.wasm.wasmPaths = `${self.location.origin}/ort/`
      ort.env.wasm.numThreads = 1
      det = await ort.InferenceSession.create(new Uint8Array(msg.det), { executionProviders: ['wasm'] })
      rec = await ort.InferenceSession.create(new Uint8Array(msg.rec), { executionProviders: ['wasm'] })
      post({ type: 'ready' })
      return
    }
    if (msg.type === 'recognize') {
      const img: OcrImage = { data: new Uint8Array(msg.rgba), width: msg.width, height: msg.height }
      const { input, ratio } = buildDetInput(img)
      const detOut = await det!.run({
        images: new ort.Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]),
      })
      const o = detOut['output0'] ?? detOut[Object.keys(detOut)[0]]
      const boxes = parseDetections(o.data as Float32Array, o.dims[2] as number, ratio)
      const lines = sortIntoLines(boxes)
      const out: string[] = []
      for (let li = 0; li < lines.length; li++) {
        const parts: string[] = []
        for (const b of lines[li]) {
          if (b.cls !== 1 || b.score < 0.5) continue
          const { input: ri, width } = buildRecInput(img, b)
          const r = await rec!.run({
            input: new ort.Tensor('float32', ri, [1, 1, REC_HEIGHT, width]),
          })
          const lg = r['logits'] ?? r[Object.keys(r)[0]]
          parts.push(ctcDecode(lg.data as Float32Array, lg.dims[0] as number))
        }
        if (parts.length) out.push(parts.join(' '))
        post({ type: 'progress', id: msg.id, done: li + 1, total: lines.length })
      }
      post({ type: 'result', id: msg.id, text: out.join('\n') })
    }
  } catch (err) {
    post({ type: 'error', id: (msg as { id?: number }).id, error: err instanceof Error ? err.message : String(err) })
  }
}
