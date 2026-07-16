// Copies runtime assets that must be served from stable same-origin paths
// (bundlers can't statically discover them; client networks often can't
// reach CDNs):
// - onnxruntime-web WASM variants -> public/ort/   (see src/ai/worker.ts)
// This runs automatically before dev/build; public/ort is gitignored.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function copyMatching(src, dest, pattern) {
  mkdirSync(dest, { recursive: true })
  for (const file of readdirSync(src)) {
    if (pattern.test(file)) {
      copyFileSync(join(src, file), join(dest, file))
      console.log(`${dest}/${file}`)
    }
  }
}

copyMatching(
  'node_modules/onnxruntime-web/dist',
  'public/ort',
  /^ort-wasm-simd-threaded.*\.(wasm|mjs)$/,
)
