import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { WASTE_TYPES, WASTE_BY_ID } from '../assets/wasteLabels'
import { createWasteClassifier } from '../lib/wasteOnnx'
import { guessWasteType } from '../lib/wasteGuess'
import { LiveCapture, type LiveClassifier, type LiveGuess } from './LiveCapture'
import {
  deviceId,
  EMPTY_WASTE_PROFILE,
  fetchWasteStats,
  loadWasteProfile,
  saveWasteProfile,
  uploadSample,
  type WasteProfile,
  type WasteStats,
} from '../lib/wasteContribute'
import {
  analyzeImage,
  assessOcr,
  loadSubmittedHashes,
  nearDuplicate,
  rememberHash,
  type ImageQuality,
  type OcrWarning,
} from '../lib/imageQuality'
import { GeoField } from './GeoField'
import type { GeoPoint } from '../lib/geo'

/**
 * ♻️ Contribute waste photos (/waste).
 *
 * Photograph a waste item and tag its material (plastic bottle, can, glass, …).
 * Builds an open dataset for an OFFLINE classifier that helps people sort
 * recyclables — recycling education + knowing what has resale value. Easy to
 * bootstrap (TrashNet / TACO). See docs/ENVIRONMENT-AI.md.
 */
type Phase = 'idle' | 'live' | 'label' | 'uploading'

// The real /waste model — MobileNetV2 trained from open datasets (docs/WASTE-MODEL.md),
// run via onnxruntime-web. Labels are our material type ids, in this fixed order.
// Lazy: the model only downloads when live mode opens.
const WASTE_MODEL_LABELS = [
  'can', 'glass', 'organic', 'other', 'paper', 'plastic_bottle', 'plastic_other',
]
let sharedClassifier: LiveClassifier | null = null
function liveClassifier(): LiveClassifier {
  if (!sharedClassifier) {
    sharedClassifier = createWasteClassifier({
      modelUrl: `${location.origin}/models/sengtha/iany-waste-v1/resolve/main/model.onnx`,
      labels: WASTE_MODEL_LABELS,
    })
  }
  return sharedClassifier
}

const OCR_WARN_KEY = {
  blurry: 'ocrWarnBlurry',
  dark: 'ocrWarnDark',
  bright: 'ocrWarnBright',
  lowContrast: 'ocrWarnLowContrast',
} as const

export function ContributeWasteView() {
  const [profile, setProfile] = useState<WasteProfile>(loadWasteProfile)
  const [started, setStarted] = useState(false)
  const [stats, setStats] = useState<WasteStats | null>(null)

  useEffect(() => {
    void fetchWasteStats().then(setStats)
  }, [])

  if (!started || !profile.consent) {
    return (
      <ConsentGate
        profile={profile}
        stats={stats}
        onStart={(p) => {
          saveWasteProfile(p)
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
  profile: WasteProfile
  stats: WasteStats | null
  onStart: (p: WasteProfile) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<WasteProfile>({ ...EMPTY_WASTE_PROFILE, ...profile })

  return (
    <div className="contribute">
      <h2 className="contribute-title">♻️ {t('wasteTitle')}</h2>
      <p className="contribute-lead">{t('wasteLead')}</p>

      {stats && stats.samples > 0 ? (
        <div className="voice-stats">
          <b>{stats.samples.toLocaleString()}</b> {t('wasteStatSamples')} ·{' '}
          <b>{stats.devices.toLocaleString()}</b> {t('ocrStatContributors')}
        </div>
      ) : null}

      <div className="voice-openbox">
        <div className="voice-openrow">🗂️ {t('cropOpenData')}</div>
        <div className="voice-openrow">🏅 {t('voiceOpenCredit')}</div>
        <div className="voice-openrow">🆓 {t('wasteOpenModel')}</div>
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
        <span>{t('wasteConsent')}</span>
      </label>
      <p className="voice-minor-note">{t('wasteTip')}</p>

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
  profile: WasteProfile
  stats: WasteStats | null
  onStats: (s: WasteStats | null) => void
}) {
  const { t, lang } = useI18n()
  const km = lang === 'km'
  const [phase, setPhase] = useState<Phase>('idle')
  const [image, setImage] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [type, setType] = useState('')
  const [gps, setGps] = useState<GeoPoint | null>(null)
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

  // From live mode: the frame is already downscaled; pre-select the guessed type.
  async function onLiveCapture(blob: Blob, w: number, h: number, g: LiveGuess | null) {
    setError('')
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setImage(blob)
    setDims({ w, h })
    setPreviewUrl(URL.createObjectURL(blob))
    if (g && WASTE_BY_ID[g.typeId]) setType(g.typeId)
    try {
      const q = await analyzeImage(blob)
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
    setGps(null)
    setQuality(null)
    setWarnings([])
    setIsDup(false)
    setPhase('idle')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit() {
    if (!image || !type) return
    setPhase('uploading')
    try {
      await uploadSample(
        { image, type, gps, note: note.trim() || undefined, width: dims?.w, height: dims?.h },
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

      {phase === 'live' ? (
        <LiveCapture
          classifier={liveClassifier()}
          guess={guessWasteType}
          typeLabel={(id) => {
            const w = WASTE_BY_ID[id]
            return { emoji: w?.emoji ?? '♻️', text: w ? (km ? w.km : w.en) : id }
          }}
          onCancel={() => setPhase('idle')}
          onCapture={onLiveCapture}
        />
      ) : !image ? (
        <div className="live-entry">
          <button type="button" className="live-entry-btn primary" onClick={() => setPhase('live')}>
            <span className="live-entry-ic" aria-hidden>📷</span>
            <b>{t('wasteLiveTitle')}</b>
            <small>{t('wasteLiveSub')}</small>
          </button>
          <div className="ocr-drop" onClick={() => fileRef.current?.click()}>
            <div className="ocr-drop-icon">🖼️</div>
            <div className="ocr-drop-title">{t('wasteTake')}</div>
            <div className="ocr-drop-sub">{t('wasteTakeSub')}</div>
          </div>
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
            <span>{t('wasteWhichType')}</span>
            <div className="crop-chips">
              {WASTE_TYPES.map((c) => (
                <button key={c.id} type="button" className={type === c.id ? 'active' : ''} onClick={() => setType(c.id)}>
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
              placeholder={t('wasteNotePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <small className="hint">{t('wasteWhereHint')}</small>
          <GeoField gps={gps} onChange={setGps} />

          {error ? <p className="voice-error">{error}</p> : null}
          <div className="voice-controls">
            <button className="voice-ghost" onClick={reset} disabled={phase === 'uploading'}>
              ↺ {t('cropRetake')}
            </button>
            <button
              className="voice-primary big"
              onClick={submit}
              disabled={phase === 'uploading' || !type}
            >
              {phase === 'uploading' ? `${t('voiceUploading')}…` : `✓ ${t('cropSubmit')}`}
            </button>
          </div>
        </>
      )}

      <p className="voice-tip">{t('wasteHint')}</p>
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
