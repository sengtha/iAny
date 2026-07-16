import { useEffect, useState } from 'react'
import { useModelStatus } from '../hooks/useModelStatus'
import { useI18n } from '../i18n'
import { deleteDocument, listDocuments, type DocumentSummary } from '../db/documents'
import { extractPdfText } from '../lib/pdf'
import { ingestDocument, type IngestProgress } from '../rag/ingest'
import {
  classifyDoc,
  extractTextFromString,
  fileAcceptAttribute,
  titleFromFilename,
} from '@iany/core'

export function LibraryView() {
  const { t } = useI18n()
  const status = useModelStatus()
  const [docs, setDocs] = useState<DocumentSummary[]>([])
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refresh = () => {
    void listDocuments().then(setDocs)
  }
  useEffect(refresh, [])

  const feed = async (inputs: { title: string; content: string; sourceType?: string }[]) => {
    setError('')
    try {
      for (const input of inputs) {
        await ingestDocument(input, setProgress)
      }
      setTitle('')
      setText('')
      refresh()
    } catch {
      setError(t('errorGeneric'))
    } finally {
      setProgress(null)
    }
  }

  // Read each picked file into text according to its type: plain/markup/RTF are
  // decoded here; PDFs go through pdf.js. Unsupported types are skipped with a
  // note instead of failing the whole batch.
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError('')
    const inputs: { title: string; content: string; sourceType?: string }[] = []
    const skipped: string[] = []
    try {
      for (const f of Array.from(files)) {
        const kind = classifyDoc(f.name, f.type)
        if (kind === 'pdf') {
          setReading(f.name)
          const content = await extractPdfText(f)
          if (content.trim()) inputs.push({ title: titleFromFilename(f.name), content, sourceType: 'pdf' })
          else skipped.push(f.name)
        } else if (kind === 'text') {
          const content = extractTextFromString(f.name, await f.text())
          if (content.trim()) inputs.push({ title: titleFromFilename(f.name), content, sourceType: 'file' })
          else skipped.push(f.name)
        } else {
          skipped.push(f.name)
        }
      }
    } catch {
      setError(t('errorGeneric'))
      setReading(null)
      return
    }
    setReading(null)
    if (skipped.length) setError(t('libraryFileSkipped').replace('{files}', skipped.join(', ')))
    if (inputs.length) void feed(inputs)
  }

  const busy = progress !== null || reading !== null
  const embedderLoading = status.embedder.status === 'loading'

  return (
    <div className="library">
      <section className="card">
        <h2>{t('libraryTitle')}</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('libraryDocTitle')}
          disabled={busy}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('libraryDocText')}
          rows={6}
          disabled={busy}
        />
        <div className="row">
          <button
            className="primary"
            disabled={busy || !text.trim()}
            onClick={() => void feed([{ title, content: text }])}
          >
            {t('libraryAdd')}
          </button>
          <label className="filepick">
            {t('libraryAddFile')}
            <input
              type="file"
              accept={fileAcceptAttribute()}
              multiple
              hidden
              disabled={busy}
              onChange={(e) => {
                void onFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <p className="hint">{t('libraryFileTypes')}</p>
        {reading && (
          <div className="notice">
            <progress />
            <p className="hint">
              {t('libraryReadingFile')} {reading}
            </p>
          </div>
        )}
        {progress && (
          <div className="notice">
            <p className="hint">
              {t('libraryIngesting')}{' '}
              {progress.stage === 'embedding' &&
                `${t('libraryEmbedding')} ${progress.done}/${progress.total}`}
              {progress.stage === 'saving' && t('librarySaving')}
            </p>
            {embedderLoading && (
              <>
                <progress value={status.embedder.progress} max={1} />
                <p className="hint">
                  {t('settingsModelLoading')} {Math.round(status.embedder.progress * 100)}%
                </p>
              </>
            )}
            {!embedderLoading && progress.stage === 'embedding' && (
              <progress value={progress.done} max={progress.total} />
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section>
        {docs.length === 0 && <p className="empty">{t('libraryEmpty')}</p>}
        {docs.map((doc) => (
          <div key={doc.id} className="card doc">
            <div>
              <strong>{doc.title}</strong>
              <p className="hint">
                {doc.lang} · {doc.chunk_count} {t('libraryChunks')}
                {doc.pack_id ? ' · 📦' : ''}
              </p>
            </div>
            <button
              className="danger"
              onClick={() => {
                void deleteDocument(doc.id).then(refresh)
              }}
            >
              {t('libraryDelete')}
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}
