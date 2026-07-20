import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import type { Classification, ImageClassifierAdapter } from '../lib/imageClassifier'

/**
 * 📷 Reusable "live camera + on-device guess" capture. Streams the back camera,
 * runs a MediaPipe classifier (VIDEO mode) on each frame, and shows the model's
 * best guess as an overlay chip. Tapping the shutter grabs the current frame and
 * hands it back with the guess — so the caller (a collector) can jump straight to
 * a pre-filled confirm screen. Generic: pass any classifier + label mapper, so
 * /waste, /street, etc. share one component. See docs/ENVIRONMENT-AI.md.
 */
export interface LiveGuess {
  typeId: string
  conf: number
}

export function LiveCapture({
  classifier,
  guess,
  typeLabel,
  onCapture,
  onCancel,
  maxDim = 1280,
}: {
  classifier: ImageClassifierAdapter
  /** Map ranked classifier output → a domain type + confidence (or null). */
  guess: (results: Classification[]) => LiveGuess | null
  /** How to render a type id (emoji + localized text) for the overlay chip. */
  typeLabel: (typeId: string) => { emoji: string; text: string }
  /** Called with the captured frame + the live guess (null if unsure). */
  onCapture: (blob: Blob, width: number, height: number, guess: LiveGuess | null) => void
  onCancel: () => void
  maxDim?: number
}) {
  const { t, lang } = useI18n()
  const km = lang === 'km'
  const [phase, setPhase] = useState<'loading' | 'running' | 'error'>('loading')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [live, setLive] = useState<LiveGuess | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastInfer = useRef(0)
  const liveRef = useRef<LiveGuess | null>(null)

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
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
        await classifier.prepare((f) => setProgress(f))
        if (cancelled) return
        setPhase('running')
        loop()
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : t('trafficCameraFailed'))
        setPhase('error')
      }
    }
    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loop() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (video && canvas && video.readyState >= 2 && video.videoWidth) {
      const w = video.videoWidth
      const h = video.videoHeight
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0, w, h)
      const now = performance.now()
      if (now - lastInfer.current > 180) {
        lastInfer.current = now
        const res = classifier.classifyVideo(video, Math.round(now), 5)
        const g = guess(res)
        liveRef.current = g
        setLive(g)
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const vw = video.videoWidth
    const vh = video.videoHeight
    const scale = Math.min(1, maxDim / Math.max(vw, vh))
    const w = Math.max(1, Math.round(vw * scale))
    const h = Math.max(1, Math.round(vh * scale))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(video, 0, 0, w, h)
    c.toBlob(
      (b) => {
        if (b) onCapture(b, w, h, liveRef.current)
      },
      'image/jpeg',
      0.85,
    )
  }

  const chip = live ? typeLabel(live.typeId) : null

  return (
    <div className="live-capture">
      <div className="traffic-stage">
        <video ref={videoRef} className="traffic-video" playsInline muted />
        <canvas ref={canvasRef} className="traffic-canvas" />
        {phase === 'running' ? (
          <div className={`live-guess ${chip ? '' : 'live-guess-none'}`}>
            {chip ? (
              <>
                <span aria-hidden>{chip.emoji}</span>
                <span>{km ? 'ទំនងជា' : 'Looks like'}: <b>{chip.text}</b></span>
                <small>{Math.round((live?.conf ?? 0) * 100)}%</small>
              </>
            ) : (
              <span>{km ? 'ចង្អុលទៅវត្ថុមួយ…' : 'Point at one item…'}</span>
            )}
          </div>
        ) : null}
        <div className="live-guess-tag">{km ? 'ការទាយ (បេតា)' : 'Guess (beta)'}</div>
      </div>

      {error ? <p className="voice-error">{error}</p> : null}

      <div className="voice-controls">
        <button className="voice-ghost" onClick={onCancel}>
          ✕ {km ? 'បិទ' : 'Close'}
        </button>
        {phase === 'loading' ? (
          <button className="voice-primary big" disabled>
            {t('trafficLoading')} {Math.round(progress * 100)}%
          </button>
        ) : (
          <button className="voice-primary big" onClick={capture} disabled={phase !== 'running'}>
            📸 {km ? 'ថត' : 'Capture'}
          </button>
        )}
      </div>

      <p className="voice-minor-note">
        {km
          ? 'ការទាយ គ្រាន់តែជាការណែនាំ — អ្នកនឹងបញ្ជាក់ ឬកែ មុនផ្ញើ។'
          : 'The guess is only a hint — you confirm or correct it before sending.'}
      </p>
    </div>
  )
}
