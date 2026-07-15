import type { NewsItem, RadioFeed } from '@iany/core'
import { RADIO_API } from '../domain/types'
import { tts } from '../ai/tts'

/**
 * iAny Radio player. Pulls the news feed from the Worker and reads each item
 * aloud on-device with the Khmer TTS, always attributing the outlet by name.
 * When the queue drains it polls for new items; it's a continuous radio.
 *
 * Playback reuses `tts.speak` (sentence-streaming). Because that resolves only
 * on a natural finish, we race each item against a per-item cancel signal so
 * pause/skip/stop are instant and never leave the loop hung.
 */

export type RadioState = 'idle' | 'loading' | 'playing' | 'paused' | 'waiting' | 'error'

const POLL_MS = 20000

function attributedText(item: NewsItem): string {
  // Outlet name FIRST (responsibility + attribution), then title, body, sponsor.
  let t = `ព័ត៌មានពី ${item.outletName}។ ${item.title}។ ${item.body}`
  if (item.sponsor && item.sponsor.trim()) t += ` ឧបត្ថម្ភដោយ ${item.sponsor.trim()}។`
  return t
}

class RadioPlayer {
  state: RadioState = 'idle'
  current: NewsItem | null = null
  error = ''
  private queue: NewsItem[] = []
  private seen = new Set<string>()
  private cursor = ''
  private runId = 0
  private cancelCurrent: (() => void) | null = null
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() {
    this.listeners.forEach((fn) => fn())
  }
  private set(state: RadioState, error = '') {
    this.state = state
    this.error = error
    this.emit()
  }

  /** Fetch new items (newest-first from server); queue them oldest-first so the
   *  bulletin reads chronologically. Returns how many fresh items were added. */
  private async fetchMore(): Promise<number> {
    const res = await fetch(`${RADIO_API}/feed?since=${encodeURIComponent(this.cursor)}`)
    if (!res.ok) throw new Error(`feed ${res.status}`)
    const data = (await res.json()) as RadioFeed
    const fresh = (data.items ?? []).filter((i) => !this.seen.has(i.id))
    for (const i of [...fresh].reverse()) {
      this.seen.add(i.id)
      this.queue.push(i)
    }
    if (data.cursor) this.cursor = data.cursor
    return fresh.length
  }

  async start(): Promise<void> {
    if (this.state === 'playing' || this.state === 'loading') return
    const my = ++this.runId
    if (!tts.ready) {
      this.set('loading')
      try {
        await tts.init()
      } catch (e) {
        this.set('error', e instanceof Error ? e.message : 'TTS failed')
        return
      }
      if (my !== this.runId) return
    }
    this.set('playing')
    void this.loop(my)
  }

  private async loop(my: number): Promise<void> {
    while (my === this.runId) {
      if (this.queue.length === 0) {
        try {
          if (!this.current) this.set('loading')
          const n = await this.fetchMore()
          if (my !== this.runId) return
          if (n === 0) {
            this.set('waiting')
            await this.sleep(POLL_MS, my)
            continue
          }
          this.set('playing')
        } catch (e) {
          this.set('error', e instanceof Error ? e.message : 'feed error')
          await this.sleep(POLL_MS, my)
          continue
        }
      }
      const item = this.queue.shift()
      if (!item) continue
      this.current = item
      this.set('playing')
      await this.speakCancelable(attributedText(item))
      if (my !== this.runId) return
    }
  }

  /** Speak one item, resolving early if paused/skipped. */
  private speakCancelable(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.cancelCurrent = resolve
      tts.speak(text).then(() => resolve()).catch(() => resolve())
    }).finally(() => {
      this.cancelCurrent = null
    })
  }

  private sleep(ms: number, my: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms)
      // let stop()/pause() break the wait by bumping runId
      const check = setInterval(() => {
        if (my !== this.runId) {
          clearTimeout(id)
          clearInterval(check)
          resolve()
        }
      }, 500)
    })
  }

  /** Skip to the next item. */
  skip(): void {
    this.cancelCurrent?.()
    void tts.stop()
  }

  pause(): void {
    this.runId++
    this.cancelCurrent?.()
    void tts.stop()
    if (this.current) this.queue.unshift(this.current) // replay current on resume
    this.set('paused')
  }

  async resume(): Promise<void> {
    await this.start()
  }

  stop(): void {
    this.runId++
    this.cancelCurrent?.()
    void tts.stop()
    this.current = null
    this.queue = []
    this.set('idle')
  }
}

export const radio = new RadioPlayer()
