import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { CROP_BY_ID, CONDITION_BY_ID } from '../assets/cropLabels'
import { createWasteClassifier } from '../lib/wasteOnnx'
import type { Classification } from '../lib/imageClassifier'

/**
 * 🌱 Crop scan (/crop-scan) — a try-it experiment: point the camera at a leaf and
 * see its crop + health condition classified live, fully on-device. No consent, no
 * upload — just detection. Runs the /crop-trained model (docs/CROP-MODEL.md) via
 * onnxruntime-web (the same MobileNetV2 [-1,1] runtime as /waste-scan). To *improve*
 * it, contribute at /crop.
 */
type Phase = 'idle' | 'loading' | 'running' | 'error'

// Must match the uploaded model's labels.txt ORDER exactly (alphabetical from the
// training folders — see docs/CROP-MODEL.md §4). Starter classes; extend as the
// model grows to more crops/conditions.
const CROP_MODEL_LABELS = [
  'background',
  'cassava_disease', 'cassava_healthy',
  'maize_disease', 'maize_healthy',
  'mango_disease', 'mango_healthy',
  'rice_disease', 'rice_healthy',
]

const classifier = createWasteClassifier({
  modelUrl: `${location.origin}/models/sengtha/iany-crop-v1/resolve/main/model.onnx`,
  labels: CROP_MODEL_LABELS,
})

/** Split a `<crop>_<condition>` model label into friendly emoji + names. */
function pretty(label: string, km: boolean): { emoji: string; text: string; healthy: boolean } {
  if (label === 'background') {
    return { emoji: '🚫', text: km ? 'មិនមែនស្លឹក' : 'Not a leaf', healthy: false }
  }
  const i = label.lastIndexOf('_')
  const crop = CROP_BY_ID[label.slice(0, i)]
  const cond = CONDITION_BY_ID[label.slice(i + 1)]
  const cropName = crop ? (km ? crop.km : crop.en) : label.slice(0, i)
  const condName = cond ? (km ? cond.km : cond.en) : label.slice(i + 1)
  return {
    emoji: `${crop?.emoji ?? '🌱'}${cond?.emoji ?? ''}`,
    text: `${cropName} · ${condName}`,
    healthy: label.endsWith('_healthy'),
  }
}

export function CropScanView() {
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
      const msg = e instanceof Error ? e.message : String(e)
      // The model repo may not be published yet — say so plainly instead of a raw error.
      const notYet = /model download failed|404|Failed to fetch/i.test(msg)
      setError(
        notYet
          ? (km
              ? 'ម៉ូឌែលដំណាំមិនទាន់ចេញផ្សាយនៅឡើយ (កំពុងបណ្ដុះបណ្ដាល)។ សូមមើល docs/CROP-MODEL.md។'
              : "The crop model isn't published yet (still training). See docs/CROP-MODEL.md.")
          : (km ? 'បើកកាមេរ៉ាមិនបាន' : 'Could not open the camera.'),
      )
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
  const bestPretty = best ? pretty(best.label, km) : null
  const confident = best && best.score >= 0.5

  return (
    <div className="contribute wscan">
      <p className="contribute-lead">
        {km
          ? 'ចង្អុលកាមេរ៉ាទៅស្លឹកដំណាំ ដើម្បីស្គាល់ប្រភេទ និងសុខភាព (មានសុខភាព / ជំងឺ) ក្រៅបណ្ដាញ។'
          : 'Point the camera at a crop leaf to identify it + its health (healthy / disease), offline.'}
      </p>

      <div className="traffic-stage">
        <video ref={videoRef} className="wscan-video" playsInline muted />
        {phase === 'running' ? (
          <div className={`live-guess ${confident ? '' : 'live-guess-none'}`}>
            {confident && bestPretty ? (
              <>
                <span aria-hidden>{bestPretty.emoji}</span>
                <span>
                  <b>{bestPretty.text}</b>
                  {bestPretty.healthy ? <> · ✅ {km ? 'ល្អ' : 'healthy'}</> : null}
                </span>
                <small>{Math.round(best.score * 100)}%</small>
              </>
            ) : (
              <span>{km ? 'ចង្អុលទៅស្លឹកមួយ…' : 'Point at one leaf…'}</span>
            )}
          </div>
        ) : null}
        <div className="live-guess-tag">{km ? 'ការទាយ (ពិសោធន៍)' : 'Guess (experiment)'}</div>
      </div>

      {phase === 'running' && top.length > 0 ? (
        <div className="wscan-bars">
          {top.map((c) => {
            const p = pretty(c.label, km)
            return (
              <div key={c.label} className="wscan-bar">
                <span className="wscan-bar-name">{p.emoji} {p.text}</span>
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
            🌱 {km ? 'ចាប់ផ្ដើមស្កេន' : 'Start scanning'}
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
          ? 'ការទាយ គ្រាន់តែជាការណែនាំ មិនមែនកសិកម្មជំនាញ។ ជួយកែលម្អ ⟶ ចូលរួមរូបថតនៅ '
          : 'A guess, not an agronomist. Help it improve ⟶ contribute photos at '}
        <a href="/crop">/crop</a>.
      </p>
      <p className="voice-tip">
        {km
          ? 'ដំណើរការលើឧបករណ៍ទាំងស្រុង — រូបភាពមិនចេញពីទូរស័ព្ទ។'
          : 'Runs fully on your device — no image leaves the phone.'}
      </p>
    </div>
  )
}
