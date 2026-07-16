/**
 * PDF → text for the Library. Uses pdf.js purely for its text layer (no
 * rendering), so a text-based PDF becomes clean, chunkable knowledge fully
 * offline. Scanned/image-only PDFs have no text layer and yield little or
 * nothing — there's no OCR fallback, so those import as (near) empty.
 *
 * pdf.js and its worker are dynamically imported so this ~1 MB of code only
 * loads the first time someone actually opens a PDF.
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

let workerReady = false

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  if (!workerReady) {
    // Vite resolves this to a hashed, self-hosted asset URL — no CDN, works
    // offline once the app is installed.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    workerReady = true
  }
  return pdfjs
}

/** Extract all text from a PDF, one page per line-group, in reading order. */
export async function extractPdfText(
  source: File | ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
): Promise<string> {
  const pdfjs = await loadPdfjs()
  const data = source instanceof File ? await source.arrayBuffer() : source
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  try {
    const pages: string[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const text = content.items
        .map((it) => ('str' in it ? (it as TextItem).str : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
      if (text) pages.push(text)
      page.cleanup()
      onProgress?.(n, doc.numPages)
    }
    return pages.join('\n\n').trim()
  } finally {
    await doc.destroy()
  }
}
