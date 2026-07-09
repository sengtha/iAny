// Copies the onnxruntime-web runtime (all WASM variants + their .mjs
// loaders) into public/ort/. ONNX Runtime picks a variant at runtime by
// device capability (jsep/jspi for WebGPU, asyncify/plain for CPU), and
// Vite's static analysis only discovers one of them — so we serve the whole
// set from a stable path and point Transformers.js at it (see src/ai/worker.ts).
// public/ort/ is gitignored; this runs automatically before dev and build.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const src = 'node_modules/onnxruntime-web/dist'
const dest = 'public/ort'
mkdirSync(dest, { recursive: true })

for (const file of readdirSync(src)) {
  if (/^ort-wasm-simd-threaded.*\.(wasm|mjs)$/.test(file)) {
    copyFileSync(join(src, file), join(dest, file))
    console.log(`${dest}/${file}`)
  }
}
