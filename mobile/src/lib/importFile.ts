import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { classifyDoc, extractTextFromString, titleFromFilename } from '@iany/core'
import { extractPdfText, pdfSupported } from './pdf'

export interface ImportedDoc {
  title: string
  content: string
  sourceType: string
}

export interface ImportResult {
  docs: ImportedDoc[]
  /** Names we couldn't read (unsupported type, or empty after extraction). */
  skipped: string[]
  /** PDFs skipped only because this build lacks the native extractor (Expo Go). */
  pdfUnavailable: string[]
}

/**
 * Open the system file picker and turn each chosen file into ingestable text.
 * Text-family files (txt/md/csv/json/html/xml/rtf/…) are decoded via the shared
 * core extractor, so the PWA and mobile treat them identically; PDFs go through
 * the native text-layer extractor (Apache PDFBox / PDFKit), fully offline.
 */
export async function pickAndReadDocuments(): Promise<ImportResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    // A broad net; we classify precisely per-file below.
    type: ['text/*', 'application/json', 'application/xml', 'application/pdf'],
  })
  if (res.canceled) return null

  const docs: ImportedDoc[] = []
  const skipped: string[] = []
  const pdfUnavailable: string[] = []
  const canPdf = pdfSupported()

  for (const asset of res.assets) {
    const name = asset.name || 'document'
    const kind = classifyDoc(name, asset.mimeType ?? undefined)
    try {
      if (kind === 'pdf') {
        if (!canPdf) {
          pdfUnavailable.push(name)
          continue
        }
        const content = await extractPdfText(asset.uri)
        if (content.trim()) docs.push({ title: titleFromFilename(name), content, sourceType: 'pdf' })
        else skipped.push(name)
      } else if (kind === 'text') {
        const raw = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        })
        const content = extractTextFromString(name, raw)
        if (content.trim()) docs.push({ title: titleFromFilename(name), content, sourceType: 'file' })
        else skipped.push(name)
      } else {
        skipped.push(name)
      }
    } catch {
      skipped.push(name)
    }
  }

  return { docs, skipped, pdfUnavailable }
}
