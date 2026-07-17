import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { khmerOcr, type OcrProgress } from '../ai/khmerOcr'
import {
  deviceId,
  EMPTY_OCR_PROFILE,
  fetchOcrStats,
  loadOcrProfile,
  saveOcrProfile,
  uploadSample,
  type OcrProfile,
  type OcrStats,
} from '../lib/ocrContribute'

/**
 * 📷 Contribute Khmer text photos — a community data-collection screen (/scan).
 *
 * Take/upload a photo of Khmer text; the on-device OCR pre-fills what it reads,
 * you correct it, and the (image, verified text) pair joins an open dataset for
 * training a better Khmer OCR model. Correcting a machine guess is fast and,
 * as a bonus, records exactly where the current model fails.
 *
 * Consent-first (open dataset + credit), progress + identity kept on-device.
 */
type Phase = 'idle' | 'ocr' | 'ready' | 'uploading'

export function ContributeOcrView() {
  const [profile, setProfile] = useState<OcrProfile>(loadOcrProfile)
  const [started, setStarted] = useState(false)
  const [stats, setStats] = useState<OcrStats | null>(null)

  useEffect(() => {
    void fetchOcrStats().then(setStats)
  }, [])

  if (!started || !profile.consent) {
    return (
      <ConsentGate
        profile={profile}
        stats={stats}
        onStart={(p) => {
          saveOcrProfile(p)
          setProfile(p)
          setStarted(true)
        }}
      />
    )
  }
  return <Scanner profile={profile} stats={stats} onStats={setStats} />
}

/* -------------------------------------------------------------------------- */

function ConsentGate({
  profile,
  stats,
  onStart,
}: {
  profile: OcrProfile
  stats: OcrStats | null
  onStart: (p: OcrProfile) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<OcrProfile>({ ...EMPTY_OCR_PROFILE, ...profile })

  return (
    <div className="contribute">
      <h2 className="contribute-title">📷 {t('ocrTitle')}</h2>
      <p className="contribute-lead">{t('ocrLead')}</p>

      {stats && stats.samples > 0 ? (
        <div className="voice-stats">
          <b>{stats.samples.toLocaleString()}</b> {t('ocrStatSamples')} ·{' '}
          <b>{stats.devices.toLocaleString()}</b> {t('ocrStatContributors')}
        </div>
      ) : null}

      <div className="voice-openbox">
        <div className="voice-openrow">🗂️ {t('ocrOpenData')}</div>
        <div className="voice-openrow">🏅 {t('voiceOpenCredit')}</div>
        <div className="voice-openrow">🆓 {t('ocrOpenModel')}</div>
      </div>

      <fieldset className="voice-fields">
        <label className="voice-field">
          <span>{t('voiceCreditName')}</span>
          <input
            type="text"
            value={draft.creditName}
            maxLength={60}
            placeholder={t('voiceCreditPlaceholder')}
            onChange={(e) => setDraft({ ...draft, creditName: e.target.value })}
          />
          <small>{t('voiceCreditHint')}</small>
        </label>
        <label className="voice-field">
          <span>{t('voiceRegion')}</span>
          <input
            type="text"
            value={draft.region}
            maxLength={40}
            placeholder={t('voiceRegionPlaceholder')}
            onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          />
        </label>
      </fieldset>

      <label className="voice-consent">
        <input
          type="checkbox"
          checked={draft.consent}
          onChange={(e) => setDraft({ ...draft, consent: e.target.checked })}
        />
        <span>{t('ocrConsent')}</span>
      </label>
      <p className="voice-minor-note">{t('ocrTip')}</p>

      <button className="voice-primary" disabled={!draft.consent} onClick={() => onStart(draft)}>
        {t('ocrStart')}
      </button>
      <p className="voice-anon">
        {t('voiceAnon')}: {deviceId()}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Scanner({
  profile,
  stats,
  onStats,
}: {
  profile: OcrProfile
  stats: OcrStats | null
  onStats: (s: OcrStats | null) => void
}) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('idle')
  const [image, setImage] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [ocrGuess, setOcrGuess] = useState('')
  const [text, setText] = useState('')
  const [ocrProg, setOcrProg] = useState<OcrProgress | null>(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function onPick(file: File) {
    setError('')
    const scaled = await downscaleImage(file, 1600)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setImage(scaled.blob)
    setDims({ w: scaled.width, h: scaled.height })
    setPreviewUrl(URL.createObjectURL(scaled.blob))
    setText('')
    setOcrGuess('')
    setPhase('ocr')
    try {
      const read = await khmerOcr.recognizeImage(scaled.blob, setOcrProg)
      setOcrGuess(read)
      setText(read)
    } catch {
      // OCR failed/unavailable — user can still type the text by hand.
    } finally {
      setOcrProg(null)
      setPhase('ready')
    }
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setImage(null)
    setPreviewUrl('')
    setDims(null)
    setOcrGuess('')
    setText('')
    setPhase('idle')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit() {
    if (!image || !text.trim()) return
    setPhase('uploading')
    try {
      await uploadSample(
        { image, text: text.trim(), ocrGuess: ocrGuess || undefined, width: dims?.w, height: dims?.h },
        profile,
      )
      setCount((c) => c + 1)
      if (stats) onStats({ ...stats, samples: stats.samples + 1 })
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ocrUploadFailed'))
      setPhase('ready')
    }
  }

  const ocrStatusText =
    ocrProg?.status === 'downloading'
      ? `${t('ocrDownloading')} ${Math.round((ocrProg.progress ?? 0) * 100)}%`
      : ocrProg?.status === 'loading' || phase === 'ocr'
        ? t('ocrReading')
        : ''

  return (
    <div className="contribute">
      <div className="voice-progress">
        <div className="ocr-count">
          ✅ {count} {t('ocrDoneCount')}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onPick(f)
        }}
      />

      {!image ? (
        <div className="ocr-drop" onClick={() => fileRef.current?.click()}>
          <div className="ocr-drop-icon">📷</div>
          <div className="ocr-drop-title">{t('ocrTake')}</div>
          <div className="ocr-drop-sub">{t('ocrTakeSub')}</div>
        </div>
      ) : (
        <>
          <img className="ocr-preview" src={previewUrl} alt="" />
          {ocrStatusText ? <p className="stt-status">{ocrStatusText}</p> : null}
          <label className="voice-field">
            <span>{t('ocrCorrect')}</span>
            <textarea
              className="ocr-text"
              lang="km"
              rows={4}
              value={text}
              placeholder={t('ocrTypePlaceholder')}
              onChange={(e) => setText(e.target.value)}
              disabled={phase === 'ocr' || phase === 'uploading'}
            />
            <small>{t('ocrCorrectHint')}</small>
          </label>
          {error ? <p className="voice-error">{error}</p> : null}
          <div className="voice-controls">
            <button className="voice-ghost" onClick={reset} disabled={phase === 'uploading'}>
              ↺ {t('ocrRetake')}
            </button>
            <button
              className="voice-primary big"
              onClick={submit}
              disabled={phase === 'ocr' || phase === 'uploading' || !text.trim()}
            >
              {phase === 'uploading' ? `${t('voiceUploading')}…` : `✓ ${t('ocrSubmit')}`}
            </button>
          </div>
        </>
      )}

      <p className="voice-tip">{t('ocrHint')}</p>
    </div>
  )
}

/** Downscale a photo to <= maxDim on its long edge and re-encode as JPEG, so
 *  uploads stay small and consistent. */
async function downscaleImage(
  file: Blob,
  maxDim: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.85),
  )
  return { blob, width: w, height: h }
}
