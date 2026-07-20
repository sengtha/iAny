import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { CROPS, CONDITIONS } from '../assets/cropLabels'
import {
  deviceId,
  EMPTY_CROP_PROFILE,
  fetchCropStats,
  loadCropProfile,
  saveCropProfile,
  uploadSample,
  type CropProfile,
  type CropStats,
} from '../lib/cropContribute'
import {
  analyzeImage,
  assessOcr,
  loadSubmittedHashes,
  nearDuplicate,
  rememberHash,
  type ImageQuality,
  type OcrWarning,
} from '../lib/imageQuality'

/**
 * 🌱 Contribute crop photos — a community data-collection screen (/crop).
 *
 * Photograph a crop, tag it (crop + healthy/disease/pest/deficiency), and it joins
 * an open dataset for training a free, offline crop-health classifier that can help
 * farmers spot problems early — no connection, no lab. Consent-first (open dataset +
 * credit); identity kept on-device.
 */
type Phase = 'idle' | 'label' | 'uploading'

const OCR_WARN_KEY = {
  blurry: 'ocrWarnBlurry',
  dark: 'ocrWarnDark',
  bright: 'ocrWarnBright',
  lowContrast: 'ocrWarnLowContrast',
} as const

export function ContributeCropView() {
  const [profile, setProfile] = useState<CropProfile>(loadCropProfile)
  const [started, setStarted] = useState(false)
  const [stats, setStats] = useState<CropStats | null>(null)

  useEffect(() => {
    void fetchCropStats().then(setStats)
  }, [])

  if (!started || !profile.consent) {
    return (
      <ConsentGate
        profile={profile}
        stats={stats}
        onStart={(p) => {
          saveCropProfile(p)
          setProfile(p)
          setStarted(true)
        }}
      />
    )
  }
  return <Collector profile={profile} stats={stats} onStats={setStats} />
}

/* -------------------------------------------------------------------------- */

function ConsentGate({
  profile,
  stats,
  onStart,
}: {
  profile: CropProfile
  stats: CropStats | null
  onStart: (p: CropProfile) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<CropProfile>({ ...EMPTY_CROP_PROFILE, ...profile })

  return (
    <div className="contribute">
      <h2 className="contribute-title">🌱 {t('cropTitle')}</h2>
      <p className="contribute-lead">{t('cropLead')}</p>

      {stats && stats.samples > 0 ? (
        <div className="voice-stats">
          <b>{stats.samples.toLocaleString()}</b> {t('cropStatSamples')} ·{' '}
          <b>{stats.devices.toLocaleString()}</b> {t('ocrStatContributors')}
        </div>
      ) : null}

      <div className="voice-openbox">
        <div className="voice-openrow">🗂️ {t('cropOpenData')}</div>
        <div className="voice-openrow">🏅 {t('voiceOpenCredit')}</div>
        <div className="voice-openrow">🆓 {t('cropOpenModel')}</div>
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
        <span>{t('cropConsent')}</span>
      </label>
      <p className="voice-minor-note">{t('cropTip')}</p>

      <button className="voice-primary" disabled={!draft.consent} onClick={() => onStart(draft)}>
        {t('cropStart')}
      </button>
      <p className="voice-anon">
        {t('voiceAnon')}: {deviceId()}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Collector({
  profile,
  stats,
  onStats,
}: {
  profile: CropProfile
  stats: CropStats | null
  onStats: (s: CropStats | null) => void
}) {
  const { t, lang } = useI18n()
  const km = lang === 'km'
  const [phase, setPhase] = useState<Phase>('idle')
  const [image, setImage] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [crop, setCrop] = useState('')
  const [condition, setCondition] = useState('')
  const [note, setNote] = useState('')
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')
  const [quality, setQuality] = useState<ImageQuality | null>(null)
  const [warnings, setWarnings] = useState<OcrWarning[]>([])
  const [isDup, setIsDup] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function onPick(file: File) {
    setError('')
    const scaled = await downscaleImage(file, 1280)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setImage(scaled.blob)
    setDims({ w: scaled.width, h: scaled.height })
    setPreviewUrl(URL.createObjectURL(scaled.blob))
    // On-device quality gate + near-duplicate check (instant, no model download).
    try {
      const q = await analyzeImage(scaled.blob)
      setQuality(q)
      setWarnings(assessOcr(q).warnings)
      setIsDup(!!nearDuplicate(q.phash, loadSubmittedHashes()))
    } catch {
      setQuality(null)
      setWarnings([])
      setIsDup(false)
    }
    setPhase('label')
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setImage(null)
    setPreviewUrl('')
    setDims(null)
    setNote('')
    setQuality(null)
    setWarnings([])
    setIsDup(false)
    setPhase('idle')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit() {
    if (!image || !crop || !condition) return
    setPhase('uploading')
    try {
      await uploadSample(
        { image, crop, condition, note: note.trim() || undefined, width: dims?.w, height: dims?.h },
        profile,
      )
      if (quality) rememberHash(quality.phash)
      setCount((c) => c + 1)
      if (stats) onStats({ ...stats, samples: stats.samples + 1 })
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('cropUploadFailed'))
      setPhase('label')
    }
  }

  return (
    <div className="contribute">
      <div className="voice-progress">
        <div className="ocr-count">
          ✅ {count} {t('cropDoneCount')}
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
          <div className="ocr-drop-icon">🌱</div>
          <div className="ocr-drop-title">{t('cropTake')}</div>
          <div className="ocr-drop-sub">{t('cropTakeSub')}</div>
        </div>
      ) : (
        <>
          <img className="ocr-preview" src={previewUrl} alt="" />
          {isDup ? <p className="ocr-warn">🔁 {t('ocrDupWarn')}</p> : null}
          {warnings.length > 0 ? (
            <p className="ocr-warn">
              ⚠ {warnings.map((w) => t(OCR_WARN_KEY[w])).join(' · ')} {t('ocrQualityRetake')}
            </p>
          ) : null}

          <label className="voice-field">
            <span>{t('cropWhichCrop')}</span>
            <div className="crop-chips">
              {CROPS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={crop === c.id ? 'active' : ''}
                  onClick={() => setCrop(c.id)}
                >
                  {c.emoji} {km ? c.km : c.en}
                </button>
              ))}
            </div>
          </label>

          <label className="voice-field">
            <span>{t('cropCondition')}</span>
            <div className="crop-chips">
              {CONDITIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={condition === c.id ? 'active' : ''}
                  onClick={() => setCondition(c.id)}
                >
                  {c.emoji} {km ? c.km : c.en}
                </button>
              ))}
            </div>
          </label>

          <label className="voice-field">
            <span>{t('cropNote')}</span>
            <input
              type="text"
              lang="km"
              value={note}
              maxLength={120}
              placeholder={t('cropNotePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {error ? <p className="voice-error">{error}</p> : null}
          <div className="voice-controls">
            <button className="voice-ghost" onClick={reset} disabled={phase === 'uploading'}>
              ↺ {t('cropRetake')}
            </button>
            <button
              className="voice-primary big"
              onClick={submit}
              disabled={phase === 'uploading' || !crop || !condition}
            >
              {phase === 'uploading' ? `${t('voiceUploading')}…` : `✓ ${t('cropSubmit')}`}
            </button>
          </div>
        </>
      )}

      <p className="voice-tip">{t('cropHint')}</p>
    </div>
  )
}

/** Downscale a photo to <= maxDim on its long edge and re-encode as JPEG. */
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
