import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import type { Detection, TrafficDetector } from '../lib/trafficDetector'
import { LineCounter } from '../lib/tracker'

/**
 * 🚦 Live traffic tool (/traffic) — a smart-city view. Runs an on-device object
 * detector on the live camera. Two modes:
 *   • In frame  — how many vehicles + people are visible now, + congestion status.
 *   • Flow      — count vehicles as they CROSS a line (tracking over time).
 * Fully offline after the model downloads once. See docs/SMARTCITY-AI.md.
 */
type Phase = 'idle' | 'loading' | 'running' | 'error'
type Mode = 'census' | 'flow'

const ORDER = ['person', 'motorbike', 'car', 'bus', 'truck', 'bicycle'] as const
const EMOJI: Record<string, string> = {
  person: '🚶', motorbike: '🏍️', car: '🚗', bus: '🚌', truck: '🚚', bicycle: '🚲',
}
const BOX_COLOR: Record<string, string> = {
  person: '#f59e0b', motorbike: '#22c55e', car: '#38bdf8', bus: '#a855f7', truck: '#ef4444', bicycle: '#eab308',
}
const VEHICLES = ['motorbike', 'car', 'bus', 'truck', 'bicycle']

export function TrafficView({ detector }: { detector: TrafficDetector }) {
  const { t, lang } = useI18n()
  const km = lang === 'km'
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [mode, setMode] = useState<Mode>('census')
  const [counts, setCounts] = useState<Record<string, number>>({}) // in-frame census
  const [flow, setFlow] = useState<{ counts: Record<string, number>; total: number }>({ counts: {}, total: 0 })
  const [lineFrac, setLineFrac] = useState(0.55)
  const [error, setError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastUi = useRef(0)
  const modeRef = useRef<Mode>('census')
  const lineRef = useRef(0.55)
  const counterRef = useRef(new LineCounter(0.55))

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { lineRef.current = lineFrac; counterRef.current.setLine(lineFrac) }, [lineFrac])
  useEffect(() => () => stopAll(), []) // cleanup on unmount

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
      await detector.prepare((f) => setProgress(f))
      setPhase('running')
      loop()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('trafficCameraFailed'))
      setPhase('error')
      stopAll()
    }
  }

  function stop() {
    stopAll()
    setPhase('idle')
    setCounts({})
  }

  function resetFlow() {
    counterRef.current.reset()
    setFlow({ counts: {}, total: 0 })
  }

  function loop() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    if (video.readyState >= 2 && video.videoWidth) {
      const ts = Math.round(performance.now())
      const dets = detector.detect(video, ts)
      const flowMode = modeRef.current === 'flow'
      if (flowMode) counterRef.current.update(dets, video.videoHeight)
      draw(canvas, video, dets, flowMode ? lineRef.current : null)
      const now = performance.now()
      if (now - lastUi.current > 250) {
        lastUi.current = now
        if (flowMode) {
          setFlow({ counts: { ...counterRef.current.counts }, total: counterRef.current.total })
        } else {
          const c: Record<string, number> = {}
          for (const d of dets) c[d.label] = (c[d.label] ?? 0) + 1
          setCounts(c)
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  const vehicleTotal = VEHICLES.reduce((s, k) => s + (counts[k] ?? 0), 0)
  const congestion = vehicleTotal <= 4 ? 'light' : vehicleTotal <= 10 ? 'moderate' : 'heavy'
  const congestionLabel = { light: km ? 'ស្រួល' : 'Light', moderate: km ? 'មធ្យម' : 'Moderate', heavy: km ? 'កកកុញ' : 'Heavy' }[congestion]
  const shown = mode === 'flow' ? flow.counts : counts

  return (
    <div className="contribute traffic">
      <p className="contribute-lead">
        {km
          ? 'ចង្អុលកាមេរ៉ាទៅចរាចរណ៍ ដើម្បីរាប់យានយន្ត និងមនុស្ស ក្រៅបណ្ដាញ។'
          : 'Point the camera at traffic to count vehicles and people, offline.'}
      </p>

      {phase === 'running' && (
        <div className="traffic-modes">
          <button className={mode === 'census' ? 'active' : ''} onClick={() => setMode('census')}>
            👁️ {km ? 'ក្នុងស៊ុម' : 'In frame'}
          </button>
          <button className={mode === 'flow' ? 'active' : ''} onClick={() => setMode('flow')}>
            ➡️ {km ? 'រាប់ឆ្លងកាត់' : 'Count passing'}
          </button>
        </div>
      )}

      <div className="traffic-stage">
        <video ref={videoRef} className="traffic-video" playsInline muted />
        <canvas ref={canvasRef} className="traffic-canvas" />
        {phase === 'running' && mode === 'census' && (
          <div className={`traffic-status band-${congestion}`}>
            {km ? 'ចរាចរណ៍' : 'Traffic'}: <b>{congestionLabel}</b>
          </div>
        )}
        {phase === 'running' && mode === 'flow' && (
          <div className="traffic-status band-flow">
            {km ? 'ឆ្លងកាត់' : 'Passed'}: <b>{flow.total}</b>
          </div>
        )}
      </div>

      {phase === 'running' && mode === 'flow' && (
        <div className="traffic-line-ctl">
          <label>{km ? 'ខ្សែរាប់' : 'Counting line'}</label>
          <input type="range" min={10} max={90} value={Math.round(lineFrac * 100)}
            onChange={(e) => setLineFrac(Number(e.target.value) / 100)} />
          <button className="voice-ghost" onClick={resetFlow}>↺ {km ? 'កំណត់ឡើងវិញ' : 'Reset'}</button>
        </div>
      )}

      {phase === 'running' && (
        <div className="traffic-counts">
          {ORDER.filter((k) => (shown[k] ?? 0) > 0 || (mode === 'census' && (k === 'person' || k === 'car' || k === 'motorbike'))).map((k) => (
            <div key={k} className="traffic-count">
              <span className="traffic-count-emoji" aria-hidden>{EMOJI[k]}</span>
              <b>{shown[k] ?? 0}</b>
              <small>{t(`traffic_${k}`)}</small>
            </div>
          ))}
        </div>
      )}

      {error ? <p className="voice-error">{error}</p> : null}

      <div className="voice-controls">
        {phase === 'idle' || phase === 'error' ? (
          <button className="voice-primary big" onClick={start}>🚦 {t('trafficStart')}</button>
        ) : phase === 'loading' ? (
          <button className="voice-primary big" disabled>{t('trafficLoading')} {Math.round(progress * 100)}%</button>
        ) : (
          <button className="voice-ghost" onClick={stop}>⏹ {t('trafficStop')}</button>
        )}
      </div>

      <p className="voice-minor-note">
        {mode === 'flow'
          ? (km ? 'រាប់នៅពេលយានយន្តឆ្លងខ្សែ។ រំកិលខ្សែ ឬកំណត់ឡើងវិញ។' : 'Counts each vehicle as it crosses the line. Move the line, or reset.')
          : t('trafficTuktukNote')}
      </p>
      <p className="voice-tip">{t('trafficPrivacy')}</p>
    </div>
  )
}

function draw(canvas: HTMLCanvasElement, video: HTMLVideoElement, dets: Detection[], lineFrac: number | null): void {
  const w = video.videoWidth
  const h = video.videoHeight
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, w, h)
  ctx.lineWidth = Math.max(2, Math.round(w / 320))
  ctx.font = `${Math.max(12, Math.round(w / 40))}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  for (const d of dets) {
    const color = BOX_COLOR[d.label] ?? '#38bdf8'
    ctx.strokeStyle = color
    ctx.strokeRect(d.x, d.y, d.w, d.h)
    const tag = d.label
    const tw = ctx.measureText(tag).width + 8
    ctx.fillStyle = color
    ctx.fillRect(d.x, Math.max(0, d.y - 18), tw, 18)
    ctx.fillStyle = '#08101f'
    ctx.fillText(tag, d.x + 4, Math.max(0, d.y - 18) + 2)
  }
  if (lineFrac != null) {
    const y = lineFrac * h
    ctx.strokeStyle = '#f43f5e'
    ctx.lineWidth = Math.max(3, Math.round(w / 240))
    ctx.setLineDash([Math.round(w / 40), Math.round(w / 60)])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
    ctx.setLineDash([])
  }
}
