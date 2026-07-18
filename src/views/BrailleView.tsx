import { useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { khmerToBraille, khmerToBrf } from '@iany/core'
import { khmerOcr, type OcrProgress } from '../ai/khmerOcr'

/**
 * ⠿ Khmer Braille — convert Khmer text (typed, or read from a photo via OCR)
 * into Unicode Braille for display and BRF for embossers. Fully offline.
 *
 * The killer pipeline for blind-education material: photograph a Khmer page →
 * OCR reads it → Braille → download a .brf → emboss.
 */
export function BrailleView() {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [ocr, setOcr] = useState<OcrProgress | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const braille = text.trim() ? khmerToBraille(text) : ''

  const copy = () => {
    void navigator.clipboard?.writeText(braille).catch(() => {})
  }
  const downloadBrf = () => {
    const brf = khmerToBrf(text)
    const blob = new Blob([brf], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'khmer.brf'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  async function onImage(file: File) {
    setOcr({ status: 'loading' })
    try {
      const read = await khmerOcr.recognizeImage(file, setOcr)
      if (read) setText((prev) => (prev ? `${prev}\n${read}` : read))
    } catch {
      /* ignore — user can type instead */
    } finally {
      setOcr(null)
    }
  }

  const ocrText =
    ocr?.status === 'downloading'
      ? `${t('brDownloading')} ${Math.round((ocr.progress ?? 0) * 100)}%`
      : ocr && (ocr.status === 'loading' || ocr.status === 'ready')
        ? t('brReading')
        : ''

  return (
    <div className="contribute">
      <h2 className="contribute-title">⠿ {t('brTitle')}</h2>
      <p className="contribute-lead">{t('brLead')}</p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onImage(f)
        }}
      />

      <label className="voice-field">
        <span>{t('brInput')}</span>
        <textarea
          className="ocr-text"
          lang="km"
          rows={4}
          value={text}
          placeholder={t('brPlaceholder')}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      <div className="voice-controls">
        <button className="voice-ghost" onClick={() => fileRef.current?.click()} disabled={!!ocr}>
          📷 {t('brFromPhoto')}
        </button>
        {text ? (
          <button className="voice-ghost" onClick={() => setText('')}>
            ✕ {t('brClear')}
          </button>
        ) : null}
      </div>
      {ocrText ? <p className="stt-status">{ocrText}</p> : null}

      {braille ? (
        <>
          <div className="br-label">{t('brOutput')}</div>
          <div className="br-out" aria-label="Braille">
            {braille}
          </div>
          <div className="voice-controls">
            <button className="voice-ghost" onClick={copy}>
              ⧉ {t('brCopy')}
            </button>
            <button className="voice-primary big" onClick={downloadBrf}>
              ⬇ {t('brDownload')}
            </button>
          </div>
        </>
      ) : null}

      <p className="voice-minor-note">{t('brNote')}</p>
    </div>
  )
}
