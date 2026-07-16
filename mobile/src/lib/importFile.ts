import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { classifyDoc, extractTextFromString, titleFromFilename } from '@iany/core'

export interface ImportedDoc {
  title: string
  content: string
  sourceType: string
}

export interface ImportResult {
  docs: ImportedDoc[]
  /** Names we couldn't read (unsupported type, or empty after extraction). */
  skipped: string[]
  /** PDFs, called out separately — supported on the web app, not on-device yet. */
  pdfSkipped: string[]
}

/**
 * Open the system file picker and turn each chosen file into ingestable text.
 * Text-family files (txt/md/csv/json/html/xml/rtf/…) are decoded via the shared
 * core extractor, so the PWA and mobile treat them identically.
 *
 * PDFs are reported separately: reliable offline PDF text extraction needs a
 * native module we don't ship yet, so on mobile the supported route is to
 * import the PDF on the web app and share the resulting knowledge pack here.
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
  const pdfSkipped: string[] = []

  for (const asset of res.assets) {
    const name = asset.name || 'document'
    const kind = classifyDoc(name, asset.mimeType ?? undefined)
    if (kind === 'pdf') {
      pdfSkipped.push(name)
      continue
    }
    if (kind !== 'text') {
      skipped.push(name)
      continue
    }
    try {
      const raw = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      })
      const content = extractTextFromString(name, raw)
      if (content.trim()) docs.push({ title: titleFromFilename(name), content, sourceType: 'file' })
      else skipped.push(name)
    } catch {
      skipped.push(name)
    }
  }

  return { docs, skipped, pdfSkipped }
}
