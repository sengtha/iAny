import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import {
  ensureGestureRecognizer,
  recognize,
  releaseGestureRecognizer,
  type Pt,
} from '../lib/gestureRecognizer'

/**
 * ✨ Magic (/magic) — a try-it demo of **gesture → command**: point the camera at
 * your hand and each MediaPipe gesture casts a different spell on the live screen,
 * fully on-device and offline. Shows how the 7 built-in gestures (👍👎✌️☝️✊✋🤟)
 * can drive any action. Reuses the same MediaPipe plumbing as /sign.
 */
type Phase = 'idle' | 'loading' | 'running' | 'error'

interface Spell {
  em: string
  en: string
  km: string
  hue: number
}
// gesture category name → the "spell" it casts (the command it maps to)
const SPELLS: Record<string, Spell> = {
  Open_Palm: { em: '🔮', en: 'Energy orb', km: 'គ្រាប់ថាមពល', hue: 200 },
  Closed_Fist: { em: '💥', en: 'Shockwave', km: 'រលកឆក់', hue: 20 },
  Pointing_Up: { em: '⚡', en: 'Lightning', km: 'ផ្លេកបន្ទោរ', hue: 280 },
  Thumb_Up: { em: '🌟', en: 'Star burst', km: 'ផ្កាយ', hue: 48 },
  Victory: { em: '🌈', en: 'Rainbow', km: 'ឥន្ធនូ', hue: 0 },
  ILoveYou: { em: '❤️', en: 'Hearts', km: 'បេះដូង', hue: 340 },
  Thumb_Down: { em: '🌧️', en: 'Rain', km: 'ភ្លៀង', hue: 210 },
}

interface Particle {
  x: number; y: number; vx: number; vy: number
  age: number; max: number; size: number; hue: number
  grav: number; kind: 'spark' | 'emoji'; char?: string; rot: number; vr: number
}
interface Ring { x: number; y: number; r: number; vr: number; age: number; max: number; hue: number; w: number }

const MAX_PARTICLES = 520

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

  useEffect(() => () => stopAll(), [])

  function stopAll() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    releaseGestureRecognizer()
    particles.current = []
    rings.current = []
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
    ctx.clearRect(0, 0, c.width, c.height)
    const lm = lmRef.current
    const name = gestureRef.current
    if (lm) {
      spawn(name, lm, c.width, c.height, ctx)
    }
    step(ctx)
  }

  return (
    <div className="contribute wscan magic">
      <p className="contribute-lead">
        {km
          ? 'ចង្អុលកាមេរ៉ាទៅដៃរបស់អ្នក — កាយវិការនីមួយៗ បង្កើតវេទមន្តផ្សេងៗលើអេក្រង់ ក្រៅបណ្ដាញ។ នេះជាឧទាហរណ៍ កាយវិការ → បញ្ជា។'
          : 'Point the camera at your hand — each gesture casts a different spell on screen, offline. A demo of gesture → command.'}
      </p>

      <div className="traffic-stage magic-stage">
        <div className="magic-mirror">
          <video ref={videoRef} className="wscan-video" playsInline muted />
          <canvas ref={canvasRef} className="magic-canvas" />
        </div>
        {phase === 'running' ? (
          <div className="magic-spell">
            {SPELLS[spell] ? (
              <>
                <span className="magic-spell-em" aria-hidden>{SPELLS[spell].em}</span>
                <b>{km ? SPELLS[spell].km : SPELLS[spell].en}</b>
              </>
            ) : (
              <span>{km ? 'បង្ហាញកាយវិការ…' : 'Show a gesture…'}</span>
            )}
          </div>
        ) : null}
        <div className="live-guess-tag">{km ? 'វេទមន្ត (ពិសោធន៍)' : 'Magic (experiment)'}</div>
      </div>

      {phase === 'idle' || phase === 'error' ? (
        <div className="magic-legend">
          {Object.entries(SPELLS).map(([, s]) => (
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

  function spawn(name: string, lm: Pt[], W: number, H: number, ctx: CanvasRenderingContext2D) {
    const at = (i: number): [number, number] => [lm[i].x * W, lm[i].y * H]
    const spell = SPELLS[name]
    const push = (p: Partial<Particle> & { x: number; y: number }) => {
      if (particles.current.length < MAX_PARTICLES) {
        particles.current.push({
          vx: 0, vy: 0, age: 0, max: 60, size: 6, hue: 200, grav: 0, kind: 'spark', rot: 0, vr: 0, ...p,
        })
      }
    }
    const rand = (a: number, b: number) => a + Math.random() * (b - a)

    switch (name) {
      case 'Open_Palm': {
        const [x, y] = at(9)
        for (let i = 0; i < 6; i++) {
          const a = rand(0, Math.PI * 2); const sp = rand(0.4, 2.2)
          push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: rand(4, 9), hue: rand(185, 220), max: 55 })
        }
        if (Math.random() < 0.25) rings.current.push({ x, y, r: 8, vr: 3.2, age: 0, max: 40, hue: 200, w: 4 })
        break
      }
      case 'Closed_Fist': {
        const [x, y] = at(9)
        if (Math.random() < 0.5) rings.current.push({ x, y, r: 6, vr: 7, age: 0, max: 26, hue: rand(10, 35), w: 6 })
        for (let i = 0; i < 5; i++) {
          const a = rand(0, Math.PI * 2)
          push({ x, y, vx: Math.cos(a) * rand(2, 6), vy: Math.sin(a) * rand(2, 6) - 1, size: rand(3, 7), hue: rand(8, 40), grav: 0.12, max: 45 })
        }
        break
      }
      case 'Pointing_Up': {
        const [tx, ty] = at(8) // index tip
        bolt(ctx, tx, ty, tx + (Math.random() - 0.5) * 40, ty - H * 0.42)
        for (let i = 0; i < 4; i++) {
          push({ x: tx, y: ty, vx: rand(-1.5, 1.5), vy: rand(-3, -0.5), size: rand(3, 7), hue: rand(265, 300), max: 30 })
        }
        break
      }
      case 'Thumb_Up': {
        const [x, y] = at(4) // thumb tip
        for (let i = 0; i < 5; i++) {
          push({ x, y, vx: rand(-2, 2), vy: rand(-3.5, -0.5), size: rand(4, 9), hue: rand(42, 55), grav: 0.05, max: 60 })
        }
        if (Math.random() < 0.18) push({ x, y, vx: rand(-1, 1), vy: rand(-2, -0.6), size: rand(20, 30), hue: 50, kind: 'emoji', char: '⭐', max: 55, rot: rand(-0.4, 0.4), vr: rand(-0.05, 0.05) })
        break
      }
      case 'Victory': {
        const [x1, y1] = at(8); const [x2, y2] = at(12)
        const x = (x1 + x2) / 2, y = (y1 + y2) / 2
        for (let i = 0; i < 6; i++) {
          const a = rand(0, Math.PI * 2)
          push({ x, y, vx: Math.cos(a) * rand(0.5, 3), vy: Math.sin(a) * rand(0.5, 3), size: rand(4, 8), hue: rand(0, 360), max: 55 })
        }
        break
      }
      case 'ILoveYou': {
        const [x, y] = at(9)
        if (Math.random() < 0.5) push({ x: x + rand(-30, 30), y, vx: rand(-0.6, 0.6), vy: rand(-2.4, -1), size: rand(18, 34), hue: 340, kind: 'emoji', char: '❤️', max: 80, rot: rand(-0.3, 0.3), vr: rand(-0.03, 0.03) })
        break
      }
      case 'Thumb_Down': {
        const [x, y] = at(0) // wrist
        for (let i = 0; i < 4; i++) {
          push({ x: x + rand(-40, 40), y: y - rand(20, 80), vx: rand(-0.3, 0.3), vy: rand(2, 5), size: rand(3, 6), hue: rand(200, 220), grav: 0.1, max: 45 })
        }
        break
      }
      default:
        break
    }
    void spell
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
      p.x += p.vx; p.y += p.vy; p.vy += p.grav; p.age++; p.rot += p.vr
      const a = 1 - p.age / p.max
      if (p.kind === 'emoji') {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = Math.max(0, a)
        ctx.font = `${p.size}px serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillText(p.char!, 0, 0); ctx.restore()
        ctx.globalAlpha = 1
      } else {
        ctx.globalCompositeOperation = 'lighter'
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2)
        grd.addColorStop(0, `hsla(${p.hue},100%,72%,${a})`)
        grd.addColorStop(1, `hsla(${p.hue},100%,50%,0)`)
        ctx.fillStyle = grd
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2); ctx.fill()
      }
      if (p.age >= p.max) ps.splice(i, 1)
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  function bolt(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = 'hsla(285,100%,80%,0.9)'
    ctx.lineWidth = 3
    ctx.shadowColor = 'hsl(285,100%,70%)'; ctx.shadowBlur = 16
    ctx.beginPath(); ctx.moveTo(x1, y1)
    const seg = 6
    for (let i = 1; i < seg; i++) {
      const t = i / seg
      ctx.lineTo(x1 + (x2 - x1) * t + (Math.random() - 0.5) * 34, y1 + (y2 - y1) * t)
    }
    ctx.lineTo(x2, y2); ctx.stroke()
    ctx.shadowBlur = 0
    ctx.globalCompositeOperation = 'source-over'
  }
}
