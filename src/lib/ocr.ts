/**
 * On-device OCR (Tesseract.js) for feeding iAny from camera photos.
 *
 * Works on every device — CPU only, no WebGPU needed. The engine files are
 * served same-origin from /tess/ (see scripts/copy-ort.mjs) and the
 * language data comes through the app's pull-through mirror
 * (/models/tessdata2/*), so it works on networks that block CDNs and is
 * cached for offline use after the first run.
 *
 * Khmer notes: running khm+eng together lets the English recognizer
 * misread Khmer glyphs as Latin junk, so the user picks a scan language
 * and Khmer runs alone. Khmer also uses the high-accuracy (tessdata_best)
 * model — the fast variant is noticeably worse on stacked consonants.
 */
import { createWorker } from 'tesseract.js'

export type OcrLang = 'khm' | 'eng' | 'khm+eng'
export type OcrProgress = (progress: number, stage: 'loading' | 'recognizing') => void

/** Upscale + grayscale + mild contrast stretch: phone photos are often
 *  small, dim and colored, all of which hurt recognition. */
async function preprocess(image: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(image)
  const TARGET_MIN = 1600
  const MAX_DIM = 2800
  let scale = Math.max(1, TARGET_MIN / Math.min(bitmap.width, bitmap.height))
  scale = Math.min(scale, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const img = ctx.getImageData(0, 0, width, height)
  const d = img.data
  // First pass: grayscale + luminance range
  let min = 255
  let max = 0
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = y
    if (y < min) min = y
    if (y > max) max = y
  }
  // Second pass: stretch contrast to the full range
  const range = Math.max(1, max - min)
  for (let i = 0; i < d.length; i += 4) {
    const y = ((d[i] - min) / range) * 255
    d[i] = d[i + 1] = d[i + 2] = y
  }
  ctx.putImageData(img, 0, 0)

  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b as Blob), 'image/png'),
  )
}

export async function ocrImage(
  image: File | Blob,
  lang: OcrLang,
  onProgress?: OcrProgress,
): Promise<string> {
  const prepared = await preprocess(image)
  const langs = lang.split('+')
  const worker = await createWorker(langs, 1, {
    workerPath: '/tess/worker.min.js',
    corePath: '/tess/',
    langPath: `${location.origin}/models/tessdata2`,
    cachePath: 'iany-tess-2',
    gzip: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress, 'recognizing')
      else onProgress?.(m.progress, 'loading')
    },
  })
  try {
    const { data } = await worker.recognize(prepared)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}
