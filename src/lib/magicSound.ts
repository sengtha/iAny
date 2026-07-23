/**
 * Procedural sound for /magic — synthesized with the Web Audio API, so there are
 * **no audio files** to download: fully offline, a few hundred bytes of code.
 *
 *  • fire   → continuous filtered noise, gain tied to fire intensity + random crackle pops
 *  • rain   → continuous high-passed noise (patter), gated on/off
 *  • boom() → one-shot low thump + noise burst (fist shockwave)
 *  • whoosh()→ one-shot rising band-passed sweep (ignite)
 *
 * The AudioContext is created inside a user gesture (the Start button) to satisfy
 * autoplay policy. All nodes hang off one master gain; stopAudio() tears it down.
 */
let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let fireGain: GainNode | null = null
let rainGain: GainNode | null = null

function makeNoise(c: AudioContext): AudioBuffer {
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}
function loopNoise(c: AudioContext): AudioBufferSourceNode {
  const s = c.createBufferSource(); s.buffer = noise; s.loop = true; return s
}

export function initAudio(): void {
  if (ctx) { void ctx.resume?.(); return }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination)
  noise = makeNoise(ctx)

  const fireLP = ctx.createBiquadFilter(); fireLP.type = 'lowpass'; fireLP.frequency.value = 1500
  fireGain = ctx.createGain(); fireGain.gain.value = 0
  const fs = loopNoise(ctx); fs.connect(fireLP); fireLP.connect(fireGain); fireGain.connect(master); fs.start()

  const rainHP = ctx.createBiquadFilter(); rainHP.type = 'highpass'; rainHP.frequency.value = 1400
  rainGain = ctx.createGain(); rainGain.gain.value = 0
  const rs = loopNoise(ctx); rs.connect(rainHP); rainHP.connect(rainGain); rainGain.connect(master); rs.start()
}

/** Call every frame with the current fire intensity (0..1). Silent at 0. */
export function setFire(level: number): void {
  if (!ctx || !fireGain) return
  const flicker = 0.8 + Math.random() * 0.4
  fireGain.gain.setTargetAtTime(Math.min(0.4, level * 0.32 * flicker), ctx.currentTime, 0.05)
  if (level > 0.3 && Math.random() < 0.07) crackle(level)
}

/** Gate the rain patter on/off. */
export function setRain(on: boolean): void {
  if (!ctx || !rainGain) return
  rainGain.gain.setTargetAtTime(on ? 0.25 : 0, ctx.currentTime, 0.1)
}

function crackle(level: number): void {
  if (!ctx || !master || !noise) return
  const t = ctx.currentTime
  const s = ctx.createBufferSource(); s.buffer = noise
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200 + Math.random() * 2000; bp.Q.value = 7
  const g = ctx.createGain()
  s.connect(bp); bp.connect(g); g.connect(master)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(0.14 * level, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
  s.start(t, Math.random() * 1.8, 0.07)
}

/** One-shot shockwave (fist). */
export function boom(): void {
  if (!ctx || !master || !noise) return
  const t = ctx.currentTime
  const o = ctx.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.35)
  const og = ctx.createGain(); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
  o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.45)
  const s = ctx.createBufferSource(); s.buffer = noise
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'
  lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(200, t + 0.3)
  const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
  s.connect(lp); lp.connect(g); g.connect(master); s.start(t, Math.random() * 1.5, 0.3)
}

/** One-shot ignite whoosh (open palm). */
export function whoosh(): void {
  if (!ctx || !master || !noise) return
  const t = ctx.currentTime
  const s = ctx.createBufferSource(); s.buffer = noise
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2
  bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.3)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
  s.connect(bp); bp.connect(g); g.connect(master); s.start(t, Math.random() * 1.5, 0.4)
}

export function stopAudio(): void {
  if (!ctx) return
  try { void ctx.close() } catch { /* already closed */ }
  ctx = master = fireGain = rainGain = null
  noise = null
}
