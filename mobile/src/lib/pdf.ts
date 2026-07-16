/**
 * On-device PDF text extraction via expo-pdf-text-extract, which reads the PDF
 * text layer with native libraries (Apache PDFBox on Android, PDFKit on iOS) —
 * fully offline, no OCR. Text-based PDFs extract cleanly; scanned/image-only
 * PDFs have no text layer and yield little.
 *
 * The native module only exists in a development / EAS build, not Expo Go, so
 * everything is guarded by `isAvailable()`.
 */
import { extractText, isAvailable } from 'expo-pdf-text-extract'

/** Whether native PDF extraction is usable in this build. */
export function pdfSupported(): boolean {
  return isAvailable()
}

/** Extract text from a PDF file URI (file:// or, on Android, content://). */
export async function extractPdfText(uri: string): Promise<string> {
  const text = await extractText(uri)
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
