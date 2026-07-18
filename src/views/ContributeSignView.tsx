import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { SIGN_PROMPTS, SIGN_PROMPT_COUNT, type SignPrompt } from '../assets/signPrompts'
import {
  detectFrame,
  ensureHandLandmarker,
  isHandTrackingSupported,
  releaseHandLandmarker,
  type HandFrame,
} from '../lib/handTracker'
import {
  deviceId,
  EMPTY_SIGN_PROFILE,
  fetchSignStats,
  loadSignProfile,
  saveSignProfile,
  uploadSample,
  type SignProfile,
  type SignStats,
} from '../lib/signContribute'

/**
 * 🤟 Contribute Khmer Sign Language — a community data-collection screen (/sign).
 *
 * You're shown a Khmer word or letter and you sign it to the camera. The
 * on-device hand tracker (MediaPipe) records the gesture as a short sequence of
 * hand skeletons — **landmarks only, never the video** — so the data is tiny and
 * carries no face or background. Each (label, gesture) pair joins an open dataset
 * for training a free Khmer Sign Language recognition model.
 *
 * Consent-first (open dataset + credit), progress + identity kept on-device.
 */

const CAPTURE_MS = 2500 // record window per gesture
const TARGET_FPS = 20

type Phase = 'idle' | 'countdown' | 'recording' | 'review' | 'uploading'

export function ContributeSignView() {
  const [profile, setProfile] = useState<SignProfile>(loadSignProfile)
  const [started, setStarted] = useState(false)
  const [stats, setStats] = useState<SignStats | null>(null)

  useEffect(() => {
    void fetchSignStats().then(setStats)
  }, [])

  if (!started || !profile.consent) {
    return (
      <ConsentGate
        profile={profile}
        stats={stats}
        onStart={(p) => {
          saveSignProfile(p)
          setProfile(p)
          setStarted(true)
        }}
      />
    )
  }
  return <Recorder profile={profile} stats={stats} onStats={setStats} />
}

/* -------------------------------------------------------------------------- */

function ConsentGate({
  profile,
  stats,
  onStart,
}: {
  profile: SignProfile
  stats: SignStats | null
  onStart: (p: SignProfile) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<SignProfile>({ ...EMPTY_SIGN_PROFILE, ...profile })
  const supported = isHandTrackingSupported()

  return (
    <div className="contribute">
      <h2 className="contribute-title">🤟 {t('signTitle')}</h2>
      <p className="contribute-lead">{t('signLead')}</p>

      {stats && stats.samples > 0 ? (
        <div className="voice-stats">
          <b>{stats.samples.toLocaleString()}</b> {t('signStatSamples')} ·{' '}
          <b>{stats.devices.toLocaleString()}</b> {t('ocrStatContributors')} ·{' '}
          <b>{stats.labels.toLocaleString()}</b> {t('signStatLabels')}
        </div>
      ) : null}

      <div className="voice-openbox">
        <div className="voice-openrow">🖐️ {t('signOpenPrivacy')}</div>
        <div className="voice-openrow">🗂️ {t('signOpenData')}</div>
        <div className="voice-openrow">🏅 {t('voiceOpenCredit')}</div>
        <div className="voice-openrow">🆓 {t('signOpenModel')}</div>
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
        <span>{t('signConsent')}</span>
      </label>
      <p className="voice-minor-note">{t('signTip')}</p>

      {!supported ? <p className="voice-error">{t('signUnsupported')}</p> : null}

      <button
        className="voice-primary"
        disabled={!draft.consent || !supported}
        onClick={() => onStart(draft)}
      >
        {t('signStart')}
      </button>
      <p className="voice-anon">
        {t('voiceAnon')}: {deviceId()}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Recorder({
  profile,
  stats,
  onStats,
}: {
  profile: SignProfile
  stats: SignStats | null
  onStats: (s: SignStats | null) => void
}) {
  const { t, lang } = useI18n()
  const km = lang === 'km'
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const recordingRef = useRef(false)
  const framesRef = useRef<HandFrame[]>([])
  const lastCapRef = useRef(0)

  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [ready, setReady] = useState(false)
  const [handsNow, setHandsNow] = useState(0)
  const [countdown, setCountdown] = useState(0)
  const [recorded, setRecorded] = useState<HandFrame[] | null>(null)
  const [count, setCount] = useState(0)
  const [error, setError] = useState('')

  const prompt: SignPrompt = SIGN_PROMPTS[idx % SIGN_PROMPTS.length]!

  // Start camera + tracker once; draw a live landmark overlay every frame.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => {})
        await ensureHandLandmarker()
        if (cancelled) return
        setReady(true)
        loop()
      } catch (e) {
        setError(e instanceof Error ? e.message : t('signCameraFailed'))
      }
    })()

    function loop() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) return
      if (video.readyState >= 2) {
        const ts = Math.round(video.currentTime * 1000) + performance.now()
        const frame = detectFrame(video, ts)
        draw(canvas, video, frame)
        setHandsNow(frame.hands.length)
        if (recordingRef.current) {
          const now = performance.now()
          if (now - lastCapRef.current >= 1000 / TARGET_FPS) {
            framesRef.current.push(frame)
            lastCapRef.current = now
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      releaseHandLandmarker()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startCapture() {
    if (!ready || phase === 'recording' || phase === 'countdown') return
    setError('')
    setRecorded(null)
    setPhase('countdown')
    let n = 3
    setCountdown(n)
    const tick = () => {
      n -= 1
      if (n > 0) {
        setCountdown(n)
        window.setTimeout(tick, 700)
      } else {
        beginRecording()
      }
    }
    window.setTimeout(tick, 700)
  }

  function beginRecording() {
    framesRef.current = []
    lastCapRef.current = 0
    recordingRef.current = true
    setCountdown(0)
    setPhase('recording')
    window.setTimeout(() => {
      recordingRef.current = false
      const frames = framesRef.current
      framesRef.current = []
      setRecorded(frames)
      setPhase('review')
    }, CAPTURE_MS)
  }

  async function submit() {
    if (!recorded) return
    const withHands = recorded.filter((f) => f.hands.length > 0).length
    if (withHands < 3) {
      setError(t('signNoHands'))
      return
    }
    setPhase('uploading')
    try {
      await uploadSample(
        { promptId: prompt.id, label: prompt.km, fps: TARGET_FPS, frames: recorded },
        profile,
      )
      setCount((c) => c + 1)
      if (stats) onStats({ ...stats, samples: stats.samples + 1 })
      next()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('signUploadFailed'))
      setPhase('review')
    }
  }

  function next() {
    setRecorded(null)
    setError('')
    setPhase('idle')
    setIdx((i) => (i + 1) % SIGN_PROMPTS.length)
  }

  function redo() {
    setRecorded(null)
    setError('')
    setPhase('idle')
  }

  const recordedHands = recorded ? recorded.filter((f) => f.hands.length > 0).length : 0

  return (
    <div className="contribute">
      <div className="voice-progress">
        <div className="ocr-count">
          ✅ {count} {t('signDoneCount')}
        </div>
        <div className="sign-index">
          {(idx % SIGN_PROMPTS.length) + 1} / {SIGN_PROMPT_COUNT}
        </div>
      </div>

      <div className="sign-prompt">
        <div className="sign-prompt-km" lang="km">
          {prompt.km}
        </div>
        <div className="sign-prompt-en">{km ? prompt.en : prompt.en}</div>
      </div>

      <div className="sign-stage">
        <video ref={videoRef} className="sign-video" playsInline muted />
        <canvas ref={canvasRef} className="sign-canvas" />
        {!ready && !error ? <div className="sign-loading">{t('signLoadingCam')}</div> : null}
        {phase === 'countdown' && countdown > 0 ? (
          <div className="sign-countdown">{countdown}</div>
        ) : null}
        {phase === 'recording' ? <div className="sign-rec">● {t('signRecording')}</div> : null}
        {ready && phase === 'idle' ? (
          <div className={`sign-hint-hands ${handsNow > 0 ? 'ok' : ''}`}>
            {handsNow > 0 ? `🖐️ ${t('signHandsSeen')}` : t('signShowHands')}
          </div>
        ) : null}
      </div>

      {error ? <p className="voice-error">{error}</p> : null}

      {phase === 'review' && recorded ? (
        <>
          <p className="sign-review-note">
            {recordedHands > 0
              ? `🖐️ ${recordedHands} ${t('signFramesCaptured')}`
              : t('signNoHands')}
          </p>
          <div className="voice-controls">
            <button className="voice-ghost" onClick={redo} disabled={phase !== 'review'}>
              ↺ {t('signRedo')}
            </button>
            <button
              className="voice-primary big"
              onClick={submit}
              disabled={recordedHands < 3}
            >
              {`✓ ${t('signSubmit')}`}
            </button>
          </div>
        </>
      ) : (
        <div className="voice-controls">
          <button className="voice-ghost" onClick={next} disabled={phase === 'recording' || phase === 'countdown'}>
            {t('signSkip')} →
          </button>
          <button
            className="voice-primary big"
            onClick={startCapture}
            disabled={!ready || phase === 'recording' || phase === 'countdown' || phase === 'uploading'}
          >
            {phase === 'uploading'
              ? `${t('voiceUploading')}…`
              : phase === 'recording'
                ? `● ${t('signRecording')}`
                : `● ${t('signRecord')}`}
          </button>
        </div>
      )}

      <p className="voice-tip">{t('signHint')}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

// MediaPipe hand connections (pairs of the 21 landmark indices).
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

/** Draw the mirrored camera frame + the hand skeleton overlay. */
function draw(canvas: HTMLCanvasElement, video: HTMLVideoElement, frame: HandFrame) {
  const w = video.videoWidth || 640
  const h = video.videoHeight || 480
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  // Mirror horizontally so it feels like a mirror to the signer.
  ctx.save()
  ctx.translate(w, 0)
  ctx.scale(-1, 1)
  for (const hand of frame.hands) {
    const pts = hand.landmarks
    ctx.strokeStyle = 'rgba(56,189,248,0.9)'
    ctx.lineWidth = 3
    for (const [a, b] of CONNECTIONS) {
      const pa = pts[a]
      const pb = pts[b]
      if (!pa || !pb) continue
      ctx.beginPath()
      ctx.moveTo(pa[0] * w, pa[1] * h)
      ctx.lineTo(pb[0] * w, pb[1] * h)
      ctx.stroke()
    }
    ctx.fillStyle = '#f97316'
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p[0] * w, p[1] * h, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}
