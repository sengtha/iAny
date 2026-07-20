import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { WASTE_BY_ID } from '../assets/wasteLabels'
import { createWasteClassifier } from '../lib/wasteOnnx'
import type { Classification } from '../lib/imageClassifier'

/**
 * ♻️ Waste scan (/waste-scan) — a try-it experiment: point the camera at an item
 * and see its material classified live, fully on-device. No consent, no upload —
 * just detection. The real /waste-trained model (docs/WASTE-MODEL.md) via
 * onnxruntime-web. To *improve* it, contribute at /waste.
 */
type Phase = 'idle' | 'loading' | 'running' | 'error'

const WASTE_MODEL_LABELS = [
  'can', 'glass', 'organic', 'other', 'paper', 'plastic_bottle', 'plastic_other',
]

const classifier = createWasteClassifier({
  modelUrl: `${location.origin}/models/sengtha/iany-waste-v1/resolve/main/model.onnx`,
  labels: WASTE_MODEL_LABELS,
})

export function WasteScanView() {
  const { lang } = useI18n()
  const km = lang === 'km'
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [top, setTop] = useState<Classification[]>([])
  const [error, setError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastInfer = useRef(0)
  const inflight = useRef(false)

  useEffect(() => () => stopAll(), [])

  function stopAll() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }

  async function start() {
    setError('')
    setPhase('loading')
    setProgress(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play().catch(() => {})
      await classifier.prepare((f) => setProgress(f))
      setPhase('running')
      loop()
    } catch (e) {
      setError(e instanceof Error ? e.message : (km ? 'បើកកាមេរ៉ាមិនបាន' : 'Could not open the camera.'))
      setPhase('error')
      stopAll()
    }
  }

  function stop() {
    stopAll()
    setPhase('idle')
    setTop([])
  }

  function loop() {
    const video = videoRef.current
    if (video && video.readyState >= 2 && video.videoWidth) {
      const now = performance.now()
      if (!inflight.current && now - lastInfer.current > 250) {
        lastInfer.current = now
        inflight.current = true
        classifier
          .classifyFrame(video)
          .then((res) => setTop(res.slice(0, 3)))
          .catch(() => {})
          .finally(() => {
            inflight.current = false
          })
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  const best = top[0]
  const bestLabel = best ? WASTE_BY_ID[best.label] : null
  const confident = best && best.score >= 0.5

  return (
    <div className="contribute wscan">
      <p className="contribute-lead">
        {km
          ? 'ចង្អុលកាមេរ៉ាទៅវត្ថុមួយ ដើម្បីស្គាល់ប្រភេទសម្ភារៈ (ដប កំប៉ុង កែវ ...) ក្រៅបណ្ដាញ។'
          : 'Point the camera at an item to identify its material (bottle, can, glass…), offline.'}
      </p>

      <div className="traffic-stage">
        <video ref={videoRef} className="wscan-video" playsInline muted />
        {phase === 'running' ? (
          <div className={`live-guess ${confident ? '' : 'live-guess-none'}`}>
            {confident && bestLabel ? (
              <>
                <span aria-hidden>{bestLabel.emoji}</span>
                <span>
                  <b>{km ? bestLabel.km : bestLabel.en}</b>
                  {bestLabel.recyclable ? <> · ♻️ {km ? 'កែច្នៃបាន' : 'recyclable'}</> : null}
                </span>
                <small>{Math.round(best.score * 100)}%</small>
              </>
            ) : (
              <span>{km ? 'ចង្អុលទៅវត្ថុមួយ…' : 'Point at one item…'}</span>
            )}
          </div>
        ) : null}
        <div className="live-guess-tag">{km ? 'ការទាយ (បេតា)' : 'Guess (beta)'}</div>
      </div>

      {phase === 'running' && top.length > 0 ? (
        <div className="wscan-bars">
          {top.map((c) => {
            const l = WASTE_BY_ID[c.label]
            return (
              <div key={c.label} className="wscan-bar">
                <span className="wscan-bar-name">
                  {l?.emoji} {l ? (km ? l.km : l.en) : c.label}
                </span>
                <span className="wscan-bar-track">
                  <span className="wscan-bar-fill" style={{ width: `${Math.round(c.score * 100)}%` }} />
                </span>
                <small>{Math.round(c.score * 100)}%</small>
              </div>
            )
          })}
        </div>
      ) : null}

      {error ? <p className="voice-error">{error}</p> : null}

      <div className="voice-controls">
        {phase === 'idle' || phase === 'error' ? (
          <button className="voice-primary big" onClick={start}>
            ♻️ {km ? 'ចាប់ផ្ដើមស្កេន' : 'Start scanning'}
          </button>
        ) : phase === 'loading' ? (
          <button className="voice-primary big" disabled>
            {km ? 'កំពុងផ្ទុកម៉ូឌែល' : 'Loading model'} {Math.round(progress * 100)}%
          </button>
        ) : (
          <button className="voice-ghost" onClick={stop}>⏹ {km ? 'ឈប់' : 'Stop'}</button>
        )}
      </div>

      <p className="voice-minor-note">
        {km
          ? 'ការទាយ គ្រាន់តែជាការណែនាំ។ ជួយកែលម្អ ⟶ ចូលរួមរូបថតនៅ '
          : 'A guess, not a verdict. Help it improve ⟶ contribute photos at '}
        <a href="/waste">/waste</a>.
      </p>
      <p className="voice-tip">
        {km
          ? 'ដំណើរការលើឧបករណ៍ទាំងស្រុង — រូបភាពមិនចេញពីទូរស័ព្ទ។'
          : 'Runs fully on your device — no image leaves the phone.'}
      </p>
    </div>
  )
}
