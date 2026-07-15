import { useEffect, useState } from 'react'
import { useModelStatus } from '../hooks/useModelStatus'
import { useI18n } from '../i18n'
import { deleteDocument, listDocuments, type DocumentSummary } from '../db/documents'
import { ocrImage, type OcrLang } from '../lib/ocr'
import { ingestDocument, type IngestProgress } from '../rag/ingest'

export function LibraryView() {
  const { t, lang } = useI18n()
  const status = useModelStatus()
  const [docs, setDocs] = useState<DocumentSummary[]>([])
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [ocr, setOcr] = useState<{ progress: number; stage: string } | null>(null)
  // Khmer scans must run without English: the Latin recognizer misreads
  // Khmer glyphs and pollutes the output. Default follows the UI language.
  const [ocrLang, setOcrLang] = useState<OcrLang>(lang === 'km' ? 'khm' : 'eng')
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

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const inputs = await Promise.all(
      Array.from(files).map(async (f) => ({
        title: f.name.replace(/\.(txt|md|markdown)$/i, ''),
        content: await f.text(),
        sourceType: 'file',
      })),
    )
    void feed(inputs)
  }

  const onPhoto = async (file: File | null) => {
    if (!file) return
    setError('')
    setOcr({ progress: 0, stage: 'loading' })
    try {
      const text = await ocrImage(file, ocrLang, (p, stage) => setOcr({ progress: p, stage }))
      if (!text) {
        setError(t('libraryOcrEmpty'))
      } else {
        // Into the compose box for review — OCR output needs a human glance
        // before it becomes knowledge.
        setText((prev) => (prev.trim() ? `${prev}\n\n${text}` : text))
        if (!title) setTitle(file.name.replace(/\.[a-z0-9]+$/i, ''))
      }
    } catch (e) {
      console.error('[iAny] ocr failed', e)
      setError(t('errorGeneric'))
    } finally {
      setOcr(null)
    }
  }

  const busy = progress !== null || ocr !== null
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
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              multiple
              hidden
              disabled={busy}
              onChange={(e) => {
                void onFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          <label className="filepick">
            📷 {t('libraryAddPhoto')}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              disabled={busy}
              onChange={(e) => {
                void onPhoto(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <div className="row ocr-langs">
          <span className="hint">{t('libraryOcrLang')}</span>
          {(
            [
              { value: 'khm', label: 'ខ្មែរ' },
              { value: 'eng', label: 'English' },
              { value: 'khm+eng', label: t('libraryOcrLangBoth') },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              className={ocrLang === o.value ? 'primary chip' : 'chip'}
              disabled={busy}
              onClick={() => setOcrLang(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {ocr && (
          <div className="notice">
            <progress value={ocr.progress} max={1} />
            <p className="hint">
              {ocr.stage === 'recognizing' ? t('libraryOcrReading') : t('libraryOcrPreparing')}
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
