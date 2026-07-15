import { normalizeNumbers, type RadioTts } from '@iany/core'

/**
 * Web tier voice: the browser's built-in SpeechSynthesis, preferring a Khmer
 * (km) voice when the device has one (Android Chrome usually does). Numbers are
 * spelled out in Khmer via core's normalizeNumbers so they read correctly.
 *
 * This is the pragmatic web voice — it works today in a browser. The trained
 * iAny ONNX voice (as on mobile) can replace it later via onnxruntime-web; the
 * RadioTts interface stays the same, so the player doesn't change.
 */
class WebSpeechTts implements RadioTts {
  private voice: SpeechSynthesisVoice | null = null
  private done = false

  get ready(): boolean {
    return this.done
  }

  async init(): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      throw new Error('This browser has no speech synthesis.')
    }
    await this.pickVoice()
    this.done = true
  }

  private pickVoice(): Promise<void> {
    return new Promise((resolve) => {
      const choose = () => {
        const voices = window.speechSynthesis.getVoices()
        this.voice = voices.find((v) => (v.lang ?? '').toLowerCase().startsWith('km')) ?? null
        resolve()
      }
      if (window.speechSynthesis.getVoices().length) choose()
      else window.speechSynthesis.onvoiceschanged = choose
    })
  }

  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(normalizeNumbers(text))
      if (this.voice) u.voice = this.voice
      u.lang = this.voice?.lang ?? 'km-KH'
      u.onend = () => resolve()
      u.onerror = () => resolve()
      window.speechSynthesis.speak(u)
    })
  }

  stop(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }

  /** Whether the device actually has a Khmer voice (for a UI hint). */
  hasKhmerVoice(): boolean {
    return this.voice != null
  }
}

export const webTts = new WebSpeechTts()
