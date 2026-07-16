import type { RadioWaitingMusic } from '@iany/core'

// The bundled loop tracks. Vite hashes each and the PWA precaches them, so the
// music is available fully offline. `?url` keeps them as separate assets rather
// than inlining ~4 MB of base64 into the JS bundle.
const TRACKS = Object.values(
  import.meta.glob('../assets/radio/*.mp3', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>,
)

const TARGET_VOLUME = 0.3
const FADE_MS = 700

/**
 * Background loop music for the radio's `waiting` gaps. Picks a random track,
 * loops it at a gentle volume, and fades in/out so starting/stopping around the
 * spoken bulletin isn't jarring. One <audio> element, reused.
 */
class WebWaitingMusic implements RadioWaitingMusic {
  private el: HTMLAudioElement | null = null
  private fade: ReturnType<typeof setInterval> | null = null
  private playing = false

  play(): void {
    if (TRACKS.length === 0 || this.playing) return
    this.playing = true
    const el = this.ensure()
    el.src = TRACKS[Math.floor(Math.random() * TRACKS.length)]
    el.currentTime = 0
    el.volume = 0
    // Autoplay can reject until the user has interacted; they pressed Play to
    // reach the waiting state, so this normally succeeds. Ignore rejections.
    void el.play().then(
      () => this.ramp(TARGET_VOLUME),
      () => {
        this.playing = false
      },
    )
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    const el = this.el
    if (!el) return
    this.ramp(0, () => {
      el.pause()
      el.currentTime = 0
    })
  }

  private ensure(): HTMLAudioElement {
    if (!this.el) {
      const el = new Audio()
      el.loop = true
      el.preload = 'auto'
      this.el = el
    }
    return this.el
  }

  private ramp(to: number, done?: () => void): void {
    const el = this.el
    if (!el) return
    if (this.fade) clearInterval(this.fade)
    const from = el.volume
    const steps = Math.max(1, Math.round(FADE_MS / 40))
    let i = 0
    this.fade = setInterval(() => {
      i++
      el.volume = Math.min(1, Math.max(0, from + ((to - from) * i) / steps))
      if (i >= steps) {
        if (this.fade) clearInterval(this.fade)
        this.fade = null
        done?.()
      }
    }, 40)
  }
}

export const waitingMusic = new WebWaitingMusic()
