import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { khmerOcr, type OcrProgress } from '../ai/khmerOcr'
import { parseCbfCode, type CbfResult } from '../lib/cbfCode'
import { detectBarcode, isBarcodeSupported, type BarcodeResult } from '../lib/barcode'

/**
 * 🏷️ Label reader (/label) — read the Cambodian product-registration code
 * ("ច.ប.ផ NNNNN/YY") off a packaged product using the app's on-device Khmer OCR,
 * then parse the code out of the text ([`src/lib/cbfCode.ts`](../lib/cbfCode.ts)).
 * No dedicated model: detect-then-read with existing OCR. Fully offline once the
 * OCR models are cached. A future MobileNet/EfficientDet badge-detector could crop
 * the mark first for tougher photos.
 */
type Phase = 'idle' | 'reading' | 'done' | 'error'

export function LabelReaderView() {
  const { lang } = useI18n()
  const km = lang === 'km'
  const [phase, setPhase] = useState<Phase>('idle')
  const [previewUrl, setPreviewUrl] = useState('')
  const [status, setStatus] = useState<OcrProgress>({ status: 'off' })
  const [result, setResult] = useState<CbfResult | null>(null)
  const [barcode, setBarcode] = useState<BarcodeResult | null>(null)
  const [fullText, setFullText] = useState('')
  const [showText, setShowText] = useState(false)
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const barcodeSupported = isBarcodeSupported()

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  async function onPick(file: File) {
    setError('')
    setResult(null)
    setBarcode(null)
    setFullText('')
    setShowText(false)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
    setPhase('reading')
    // Barcode first — it's fast (native) and doesn't need the OCR model.
    setBarcode(await detectBarcode(file))
    try {
      const text = await khmerOcr.recognizeImage(file, (p) => setStatus(p))
      setFullText(text)
      setResult(parseCbfCode(text))
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setResult(null)
    setBarcode(null)
    setFullText('')
    setShowText(false)
    setCopied('')
    setPhase('idle')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(''), 1500)
    } catch { /* ignore */ }
  }

  const progressPct =
    status.status === 'downloading' ? Math.round((status.progress ?? 0) * 100) : null

  const readingLabel =
    status.status === 'downloading'
      ? `${km ? 'ទាញយកម៉ូឌែល OCR' : 'Downloading OCR model'} ${progressPct}%`
      : status.status === 'loading'
        ? km ? 'កំពុងផ្ទុកម៉ូឌែល…' : 'Loading model…'
        : km ? 'កំពុងអានស្លាក…' : 'Reading the label…'

  return (
    <div className="contribute">
      <p className="contribute-lead">
        {km
          ? 'ថតស្លាកផលិតផលមួយដង ដើម្បីអានលេខ ច.ប.ផ និងបាកូដ ក្រៅបណ្ដាញ។'
          : 'Photograph a product label once to read its ច.ប.ផ code and barcode — on-device, offline.'}
      </p>
      {!barcodeSupported ? (
        <p className="voice-minor-note">
          {km
            ? '⚠ កម្មវិធីអ៊ីនធឺណិតនេះមិនអានបាកូដទេ (សូមប្រើ Chrome នៅ Android) — នៅតែអានលេខ ច.ប.ផ បាន។'
            : '⚠ This browser can’t scan barcodes (use Chrome on Android) — it still reads the ច.ប.ផ code.'}
        </p>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f) }}
      />

      {phase === 'idle' ? (
        <div className="ocr-drop" onClick={() => fileRef.current?.click()}>
          <div className="ocr-drop-icon">🏷️</div>
          <div className="ocr-drop-title">{km ? 'ថត / ជ្រើសរូបស្លាក' : 'Take / choose a label photo'}</div>
          <div className="ocr-drop-sub">
            {km ? 'ឲ្យឃើញទាំង ច.ប.ផ និងបាកូដ ពន្លឺល្អ គ្មានចាំង' : 'Show both the ច.ប.ផ mark and the barcode — good light, no glare'}
          </div>
        </div>
      ) : (
        <>
          {previewUrl ? <img className="ocr-preview" src={previewUrl} alt="" /> : null}

          {phase === 'reading' ? (
            <div className="label-reading">
              <span className="spinner" aria-hidden />
              <span>{readingLabel}</span>
            </div>
          ) : null}

          {barcode ? (
            <div className="label-result method-barcode">
              <div className="label-result-tag">{km ? 'បាកូដ' : 'Barcode'} · {fmtBarcode(barcode.format)}</div>
              <div className="label-code">{barcode.value}</div>
              <button className="voice-primary" onClick={() => copy(barcode.value, 'bc')}>
                {copied === 'bc' ? (km ? '✓ ចម្លងរួច' : '✓ Copied') : (km ? '⧉ ចម្លងបាកូដ' : '⧉ Copy barcode')}
              </button>
            </div>
          ) : phase === 'done' && barcodeSupported ? (
            <div className="label-result method-none">
              <div className="label-code-none">{km ? 'រកបាកូដមិនឃើញ' : 'No barcode found'}</div>
            </div>
          ) : null}

          {phase === 'done' && result ? (
            <div className={`label-result method-${result.method}`}>
              <div className="label-result-tag">ច.ប.ផ</div>
              <div className="label-code">{result.code}</div>
              <button className="voice-primary" onClick={() => copy(result.code, 'code')}>
                {copied === 'code' ? (km ? '✓ ចម្លងរួច' : '✓ Copied') : (km ? '⧉ ចម្លងលេខ' : '⧉ Copy code')}
              </button>
              <p className="voice-minor-note">
                {result.method === 'badge'
                  ? (km ? 'រកឃើញនៅជាប់សញ្ញា ច.ប.ផ' : 'Found next to the ច.ប.ផ mark')
                  : (km ? 'ផ្គូផ្គងតាមទម្រង់លេខ — សូមផ្ទៀងផ្ទាត់' : 'Matched by number pattern — please verify')}
              </p>
            </div>
          ) : null}

          {phase === 'done' && !result ? (
            <div className="label-result method-none">
              <div className="label-code-none">{km ? 'រកលេខ ច.ប.ផ មិនឃើញ' : 'No ច.ប.ផ code found'}</div>
              <p className="voice-minor-note">
                {km
                  ? 'សាកម្ដងទៀត៖ ចូលឲ្យជិត តម្រង់ឲ្យច្បាស់ លើលេខ ច.ប.ផ ក្នុងពន្លឺល្អ។'
                  : 'Try again: get closer and focus on the ច.ប.ផ number, in good light.'}
              </p>
            </div>
          ) : null}

          {error ? <p className="voice-error">{error}</p> : null}

          {fullText ? (
            <div className="label-fulltext">
              <button className="voice-ghost small" onClick={() => setShowText((s) => !s)}>
                {showText ? (km ? 'លាក់អត្ថបទ' : 'Hide full text') : (km ? 'បង្ហាញអត្ថបទទាំងអស់' : 'Show all text read')}
              </button>
              {showText ? <pre className="label-ocr-text">{fullText}</pre> : null}
            </div>
          ) : null}

          <div className="voice-controls">
            <button className="voice-ghost" onClick={reset} disabled={phase === 'reading'}>
              ↺ {km ? 'ថតម្ដងទៀត' : 'New photo'}
            </button>
          </div>
        </>
      )}

      <p className="voice-tip">
        {km
          ? 'ដំណើរការលើឧបករណ៍ទាំងស្រុង — រូបភាពមិនចេញពីទូរស័ព្ទ។'
          : 'Runs fully on your device — the photo never leaves your phone.'}
      </p>
    </div>
  )
}

/** "ean_13" → "EAN-13", "qr_code" → "QR-CODE". */
function fmtBarcode(format: string): string {
  return format.replace(/_/g, '-').toUpperCase()
}
