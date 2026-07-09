// Copies runtime assets that must be served from stable same-origin paths
// (bundlers can't statically discover them; client networks often can't
// reach CDNs):
// - onnxruntime-web WASM variants -> public/ort/   (see src/ai/worker.ts)
// - tesseract.js worker + core    -> public/tess/  (see src/lib/ocr.ts)
// Both directories are gitignored; this runs automatically before dev/build.
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
copyMatching('node_modules/tesseract.js/dist', 'public/tess', /^worker\.min\.js$/)
copyMatching('node_modules/tesseract.js-core', 'public/tess', /^tesseract-core.*\.(js|wasm)$/)
