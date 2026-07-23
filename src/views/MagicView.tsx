import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import {
  ensureGestureRecognizer,
  recognize,
  releaseGestureRecognizer,
  type Pt,
} from '../lib/gestureRecognizer'

/**
 * ✨ Magic (/magic) — a try-it demo of **gesture → command** with a little fire
 * mechanic, fully on-device and offline (MediaPipe Gesture Recognizer, same engine
 * as /sign):
 *   ✊ Fist       → shockwave
 *   ✋ Open palm  → ignite a BIG fire (a persistent state — it keeps burning)
 *   👎 Thumb down → rain that puts the fire out
 * Fire is a stateful intensity, so it survives between frames until you rain on it.
 */
type Phase = 'idle' | 'loading' | 'running' | 'error'

interface Spell { em: string; en: string; km: string }
const SPELLS: Record<string, Spell> = {
  Closed_Fist: { em: '💥', en: 'Shockwave', km: 'រលកឆក់' },
  Open_Palm: { em: '🔥', en: 'Ignite fire', km: 'បង្កាត់ភ្លើង' },
  Thumb_Down: { em: '🌧️', en: 'Rain — put it out', km: 'ភ្លៀង — ពន្លត់ភ្លើង' },
}

interface Particle {
  x: number; y: number; vx: number; vy: number
  age: number; max: number; size: number; hue: number
  grav: number; kind: 'fire' | 'ember' | 'drop' | 'smoke'
}
interface Ring { x: number; y: number; r: number; vr: number; age: number; max: number; hue: number; w: number }

const MAX_PARTICLES = 900

export function MagicView() {
  const { lang } = useI18n()
  const km = lang === 'km'
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [spell, setSpell] = useState('None')
  const [error, setError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const lastTs = useRef(0)
  const particles = useRef<Particle[]>([])
  const rings = useRef<Ring[]>([])
  const gestureRef = useRef('None')
  const lmRef = useRef<Pt[] | null>(null)
  const lastGesture = useRef('None')
  // fire state (persists between frames until rained on)
  const fire = useRef(0)                       // 0..1 intensity
  const firePos = useRef({ x: 0.5, y: 0.7 })   // where it burns (last palm position), normalized
  const fistArmed = useRef(0)                  // frames since a fist shockwave (for the "burst into fire" flourish)

  useEffect(() => () => stopAll(), [])

  function stopAll() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    releaseGestureRecognizer()
    particles.current = []
    rings.current = []
    fire.current = 0
  }

  async function start() {
    setError('')
    setPhase('loading')
    setProgress(0.1)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play().catch(() => {})
      setProgress(0.4)
      await ensureGestureRecognizer()
      setProgress(1)
      setPhase('running')
      loop()
    } catch (e) {
      const name = (e as { name?: string })?.name ?? ''
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? (km
              ? 'កាមេរ៉ាត្រូវបានបិទ។ សូមអនុញ្ញាត ហើយផ្ទុកឡើងវិញ។ បើបើកក្នុង Facebook/Messenger សូមបើកក្នុង Chrome/Safari។'
              : 'Camera blocked. Allow access and reload. If opened inside Facebook/Messenger, open in Chrome/Safari.')
          : (km ? 'បើកកាមេរ៉ាមិនបាន' : 'Could not open the camera.'),
      )
      setPhase('error')
      stopAll()
    }
  }

  function stop() {
    stopAll()
    setPhase('idle')
    setSpell('None')
  }

  function loop() {
    const v = videoRef.current
    const c = canvasRef.current
    if (v && c && v.readyState >= 2 && v.videoWidth) {
      if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight }
      const now = performance.now()
      if (now > lastTs.current) {
        lastTs.current = now
        const g = recognize(v, now)
        gestureRef.current = g.name
        lmRef.current = g.landmarks
        if (g.name !== lastGesture.current) { lastGesture.current = g.name; setSpell(g.name) }
      }
      render(c)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  function render(c: HTMLCanvasElement) {
    const ctx = c.getContext('2d')!
    const W = c.width, H = c.height
    ctx.clearRect(0, 0, W, H)
    const name = gestureRef.current
    const lm = lmRef.current
    if (lm) firePos.current = { x: lm[9].x, y: lm[9].y }   // palm base = middle-finger MCP
    const fx = firePos.current.x * W, fy = firePos.current.y * H
    if (fistArmed.current > 0) fistArmed.current--

    // --- gesture → command (the fire state machine) ---
    if (name === 'Closed_Fist' && lm) {
      const [hx, hy] = [lm[9].x * W, lm[9].y * H]
      if (Math.random() < 0.5) rings.current.push({ x: hx, y: hy, r: 6, vr: 8, age: 0, max: 26, hue: 200, w: 6 })
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2
        particles.current.push(mk({ x: hx, y: hy, vx: Math.cos(a) * rand(2, 6), vy: Math.sin(a) * rand(2, 6), size: rand(3, 6), hue: 210, kind: 'ember', grav: 0.1, max: 34 }))
      }
      fistArmed.current = 25                       // arm the "burst into fire" for the next open palm
    } else if (name === 'Open_Palm') {
      // ignite / grow a BIG fire; a recent fist makes the ignition burst bigger
      fire.current = Math.min(1, fire.current + (fistArmed.current > 0 ? 0.09 : 0.045))
      if (fistArmed.current > 0 && Math.random() < 0.4) {
        rings.current.push({ x: fx, y: fy, r: 10, vr: 6, age: 0, max: 30, hue: 30, w: 7 })
      }
    } else if (name === 'Thumb_Down') {
      fire.current = Math.max(0, fire.current - 0.05)   // rain puts it out
      rain(fx, fy)
    } else {
      fire.current = Math.max(0, fire.current - 0.004)  // idle: slowly burns down
    }

    // --- draw the fire from its current intensity (persists between frames) ---
    if (fire.current > 0.02) drawFire(ctx, fx, fy, fire.current)

    step(ctx)
  }

  const showFire = phase === 'running'

  return (
    <div className="contribute wscan magic">
      <p className="contribute-lead">
        {km
          ? 'ចង្អុលកាមេរ៉ាទៅដៃ៖ ✊ រលកឆក់ · ✋ បង្កាត់ភ្លើងធំ · 👎 ភ្លៀងពន្លត់ភ្លើង។ ក្រៅបណ្ដាញ។ ឧទាហរណ៍ កាយវិការ → បញ្ជា។'
          : 'Point the camera at your hand: ✊ shockwave · ✋ ignite a big fire · 👎 rain to put it out. Offline. A gesture → command demo.'}
      </p>

      <div className="traffic-stage magic-stage">
        <div className="magic-mirror">
          <video ref={videoRef} className="wscan-video" playsInline muted />
          <canvas ref={canvasRef} className="magic-canvas" />
        </div>
        {showFire ? (
          <div className="magic-spell">
            {SPELLS[spell] ? (
              <>
                <span className="magic-spell-em" aria-hidden>{SPELLS[spell].em}</span>
                <b>{km ? SPELLS[spell].km : SPELLS[spell].en}</b>
              </>
            ) : (
              <span>{km ? '✊ ✋ 👎 បង្ហាញកាយវិការ…' : '✊ ✋ 👎 show a gesture…'}</span>
            )}
          </div>
        ) : null}
        <div className="live-guess-tag">{km ? 'វេទមន្ត (ពិសោធន៍)' : 'Magic (experiment)'}</div>
      </div>

      {phase === 'idle' || phase === 'error' ? (
        <div className="magic-legend">
          {Object.values(SPELLS).map((s) => (
            <span key={s.en} className="magic-legend-item">{s.em} {km ? s.km : s.en}</span>
          ))}
        </div>
      ) : null}

      {error ? <p className="voice-error">{error}</p> : null}

      <div className="voice-controls">
        {phase === 'idle' || phase === 'error' ? (
          <button className="voice-primary big" onClick={start}>
            ✨ {km ? 'ចាប់ផ្ដើមវេទមន្ត' : 'Start the magic'}
          </button>
        ) : phase === 'loading' ? (
          <button className="voice-primary big" disabled>
            {km ? 'កំពុងផ្ទុក' : 'Loading'} {Math.round(progress * 100)}%
          </button>
        ) : (
          <button className="voice-ghost" onClick={stop}>⏹ {km ? 'ឈប់' : 'Stop'}</button>
        )}
      </div>

      <p className="voice-tip">
        {km
          ? 'ដំណើរការលើឧបករណ៍ទាំងស្រុង — រូបភាពមិនចេញពីទូរស័ព្ទ។ ដូចគ្នានឹង /sign (MediaPipe)។'
          : 'Runs fully on your device — no image leaves the phone. Same MediaPipe engine as /sign.'}
      </p>
    </div>
  )

  /* --------------------------------------------------------- effects engine --- */

  function drawFire(ctx: CanvasRenderingContext2D, x: number, y: number, lvl: number) {
    // base glow
    ctx.globalCompositeOperation = 'lighter'
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 90 * lvl + 25)
    gr.addColorStop(0, `hsla(35,100%,60%,${0.28 * lvl})`)
    gr.addColorStop(1, 'hsla(20,100%,50%,0)')
    ctx.fillStyle = gr
    ctx.beginPath(); ctx.arc(x, y, 90 * lvl + 25, 0, Math.PI * 2); ctx.fill()

    // flame + ember particles rising from the palm; count + size scale with intensity
    const n = Math.round(4 + lvl * 16)
    const spread = 14 + lvl * 42
    for (let i = 0; i < n; i++) {
      if (particles.current.length >= MAX_PARTICLES) break
      const up = -(2.4 + lvl * 5) * rand(0.6, 1.2)
      particles.current.push(mk({
        x: x + rand(-spread, spread), y: y + rand(-8, 12),
        vx: rand(-0.8, 0.8), vy: up,
        size: (6 + lvl * 14) * rand(0.5, 1), hue: rand(8, 48),
        grav: -0.03, kind: 'fire', max: Math.round(rand(34, 70)),
      }))
    }
    if (Math.random() < 0.5 * lvl) {
      particles.current.push(mk({ x: x + rand(-spread, spread), y, vx: rand(-1, 1), vy: -(3 + lvl * 5), size: rand(2, 4), hue: 45, grav: -0.02, kind: 'ember', max: 60 }))
    }
  }

  function rain(fx: number, fy: number) {
    for (let i = 0; i < 7; i++) {
      if (particles.current.length >= MAX_PARTICLES) break
      particles.current.push(mk({ x: rand(fx - 120, fx + 120), y: rand(-20, fy - 40), vx: rand(-0.4, 0.4), vy: rand(9, 15), size: rand(8, 16), hue: 205, grav: 0.15, kind: 'drop', max: 70 }))
    }
    // steam where rain meets fire
    if (fire.current > 0.05) {
      for (let i = 0; i < 4; i++) {
        if (particles.current.length >= MAX_PARTICLES) break
        particles.current.push(mk({ x: fx + rand(-40, 40), y: fy + rand(-10, 10), vx: rand(-0.6, 0.6), vy: rand(-1.6, -0.6), size: rand(10, 22), hue: 0, grav: -0.01, kind: 'smoke', max: 55 }))
      }
    }
  }

  function step(ctx: CanvasRenderingContext2D) {
    // rings
    ctx.globalCompositeOperation = 'lighter'
    const rs = rings.current
    for (let i = rs.length - 1; i >= 0; i--) {
      const r = rs[i]
      const a = 1 - r.age / r.max
      ctx.strokeStyle = `hsla(${r.hue},100%,65%,${a})`
      ctx.lineWidth = r.w * a + 1
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke()
      r.r += r.vr; r.age++
      if (r.age >= r.max) rs.splice(i, 1)
    }
    // particles
    const ps = particles.current
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]
      p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.age++
      const a = 1 - p.age / p.max
      if (p.kind === 'smoke') {
        ctx.globalCompositeOperation = 'source-over'
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size)
        g.addColorStop(0, `hsla(0,0%,80%,${0.22 * a})`)
        g.addColorStop(1, 'hsla(0,0%,70%,0)')
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill()
      } else if (p.kind === 'drop') {
        ctx.globalCompositeOperation = 'lighter'
        ctx.strokeStyle = `hsla(205,90%,75%,${a})`
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx, p.y - p.vy * 1.4); ctx.stroke()
      } else {
        // fire / ember — additive radial glow
        ctx.globalCompositeOperation = 'lighter'
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size)
        g.addColorStop(0, `hsla(${p.hue},100%,68%,${a})`)
        g.addColorStop(1, `hsla(${Math.max(0, p.hue - 15)},100%,45%,0)`)
        ctx.fillStyle = g
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill()
      }
      if (p.age >= p.max) ps.splice(i, 1)
    }
    ctx.globalCompositeOperation = 'source-over'
  }
}

function mk(p: Partial<Particle> & { x: number; y: number }): Particle {
  return { vx: 0, vy: 0, age: 0, max: 50, size: 6, hue: 30, grav: 0, kind: 'fire', ...p }
}
const rand = (a: number, b: number) => a + Math.random() * (b - a)
