import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { TESTS, LEVELS, SOURCES } from '../assets/waterLabels'
import {
  deviceId,
  EMPTY_WATER_PROFILE,
  fetchWaterStats,
  loadWaterProfile,
  saveWaterProfile,
  uploadSample,
  type WaterProfile,
  type WaterStats,
} from '../lib/waterContribute'
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
 * 💧 Contribute water-test photos (/water).
 *
 * Photograph a dipped colorimetric water test strip and tag the safety band read
 * from the kit's chart. Builds an open dataset for an OFFLINE model that reads the
 * strip → safe / caution / unsafe — guidance, not a certified measurement (see
 * docs/ENVIRONMENT-AI.md). Water safety is a rural-health issue (esp. arsenic).
 */
type Phase = 'idle' | 'label' | 'uploading'

const OCR_WARN_KEY = {
  blurry: 'ocrWarnBlurry',
  dark: 'ocrWarnDark',
  bright: 'ocrWarnBright',
  lowContrast: 'ocrWarnLowContrast',
} as const

export function ContributeWaterView() {
  const [profile, setProfile] = useState<WaterProfile>(loadWaterProfile)
  const [started, setStarted] = useState(false)
  const [stats, setStats] = useState<WaterStats | null>(null)

  useEffect(() => {
    void fetchWaterStats().then(setStats)
  }, [])

  if (!started || !profile.consent) {
    return (
      <ConsentGate
        profile={profile}
        stats={stats}
        onStart={(p) => {
          saveWaterProfile(p)
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
  profile: WaterProfile
  stats: WaterStats | null
  onStart: (p: WaterProfile) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<WaterProfile>({ ...EMPTY_WATER_PROFILE, ...profile })

  return (
    <div className="contribute">
      <h2 className="contribute-title">💧 {t('waterTitle')}</h2>
      <p className="contribute-lead">{t('waterLead')}</p>
      <p className="health-disclaimer">🧪 {t('waterDisclaimer')}</p>

      {stats && stats.samples > 0 ? (
        <div className="voice-stats">
          <b>{stats.samples.toLocaleString()}</b> {t('waterStatSamples')} ·{' '}
          <b>{stats.devices.toLocaleString()}</b> {t('ocrStatContributors')}
        </div>
      ) : null}

      <div className="voice-openbox">
        <div className="voice-openrow">📸 {t('waterPrivacy')}</div>
        <div className="voice-openrow">🗂️ {t('cropOpenData')}</div>
        <div className="voice-openrow">🆓 {t('waterOpenModel')}</div>
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
        <span>{t('waterConsent')}</span>
      </label>
      <p className="voice-minor-note">{t('waterTip')}</p>

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
  profile: WaterProfile
  stats: WaterStats | null
  onStats: (s: WaterStats | null) => void
}) {
  const { t, lang } = useI18n()
  const km = lang === 'km'
  const [phase, setPhase] = useState<Phase>('idle')
  const [image, setImage] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [test, setTest] = useState('')
  const [level, setLevel] = useState('')
  const [source, setSource] = useState('')
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
    if (!image || !test || !level) return
    setPhase('uploading')
    try {
      await uploadSample(
        { image, test, level, source: source || undefined, note: note.trim() || undefined, width: dims?.w, height: dims?.h },
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
          <div className="ocr-drop-icon">💧</div>
          <div className="ocr-drop-title">{t('waterTake')}</div>
          <div className="ocr-drop-sub">{t('waterTakeSub')}</div>
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
            <span>{t('waterWhichTest')}</span>
            <div className="crop-chips">
              {TESTS.map((c) => (
                <button key={c.id} type="button" className={test === c.id ? 'active' : ''} onClick={() => setTest(c.id)}>
                  {c.emoji} {km ? c.km : c.en}
                </button>
              ))}
            </div>
          </label>

          <label className="voice-field">
            <span>{t('waterLevel')}</span>
            <div className="crop-chips">
              {LEVELS.map((c) => (
                <button key={c.id} type="button" className={level === c.id ? 'active' : ''} onClick={() => setLevel(c.id)}>
                  {c.emoji} {km ? c.km : c.en}
                </button>
              ))}
            </div>
          </label>

          <label className="voice-field">
            <span>{t('waterSource')}</span>
            <div className="crop-chips">
              {SOURCES.map((c) => (
                <button key={c.id} type="button" className={source === c.id ? 'active' : ''} onClick={() => setSource(c.id)}>
                  {c.emoji} {km ? c.km : c.en}
                </button>
              ))}
            </div>
          </label>

          <label className="voice-field">
            <span>{t('cropNote')}</span>
            <input
              type="text"
              value={note}
              maxLength={120}
              placeholder={t('waterNotePlaceholder')}
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
              disabled={phase === 'uploading' || !test || !level}
            >
              {phase === 'uploading' ? `${t('voiceUploading')}…` : `✓ ${t('cropSubmit')}`}
            </button>
          </div>
        </>
      )}

      <p className="voice-tip">{t('waterHint')}</p>
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
