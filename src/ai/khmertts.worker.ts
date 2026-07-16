/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web'

/**
 * TTS inference worker: runs the VITS ONNX off the main thread so synthesizing
 * a long news body never freezes the UI (onnxruntime-web wasm compute is
 * synchronous on its thread). The main thread streams token ids in and gets
 * float PCM back.
 */
let session: ort.InferenceSession | null = null

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'init'; bytes: ArrayBuffer }
    | { type: 'synth'; id: number; ids: number[] }
  try {
    if (msg.type === 'init') {
      ort.env.wasm.wasmPaths = `${self.location.origin}/ort/`
      // Multi-threaded wasm is ~3× faster, but needs SharedArrayBuffer, which
      // needs cross-origin isolation (public/_headers). Fall back to 1 thread
      // when isolation isn't active so it still works everywhere.
      const cores = (self as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator
        ?.hardwareConcurrency
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, cores || 4) : 1
      session = await ort.InferenceSession.create(new Uint8Array(msg.bytes), {
        executionProviders: ['wasm'],
      })
      ;(self as unknown as Worker).postMessage({ type: 'ready' })
    } else if (msg.type === 'synth') {
      const x = new ort.Tensor('int64', BigInt64Array.from(msg.ids, (v) => BigInt(v)), [
        1,
        msg.ids.length,
      ])
      const xl = new ort.Tensor('int64', BigInt64Array.from([BigInt(msg.ids.length)]), [1])
      const out = await session!.run({ x, x_lengths: xl })
      const y = out.y ?? out[Object.keys(out)[0]]
      const pcm = y.data as Float32Array
      ;(self as unknown as Worker).postMessage({ type: 'pcm', id: msg.id, pcm }, [pcm.buffer])
    }
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      type: 'error',
      id: (msg as { id?: number }).id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
