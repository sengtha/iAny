/**
 * On-device OCR (Tesseract.js) for feeding iAny from camera photos.
 *
 * Works on every device — CPU only, no WebGPU needed. The engine files are
 * served same-origin from /tess/ (see scripts/copy-ort.mjs) and the Khmer +
 * English language data comes through the app's pull-through mirror
 * (/models/tessdata/*), so it works on networks that block CDNs and is
 * cached for offline use after the first run (Tesseract caches language
 * data in IndexedDB itself).
 */
import { createWorker } from 'tesseract.js'

export type OcrProgress = (progress: number, stage: 'loading' | 'recognizing') => void

export async function ocrImage(image: File | Blob, onProgress?: OcrProgress): Promise<string> {
  const worker = await createWorker(['khm', 'eng'], 1, {
    workerPath: '/tess/worker.min.js',
    corePath: '/tess/',
    langPath: `${location.origin}/models/tessdata`,
    gzip: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress, 'recognizing')
      else onProgress?.(m.progress, 'loading')
    },
  })
  try {
    const { data } = await worker.recognize(image)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}
