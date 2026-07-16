/**
 * iAny Radio — shared contracts between the app (client) and the Worker (D1
 * backend). Verified Cambodian outlets POST short news as text; the app pulls
 * the feed and reads it with the on-device Khmer TTS, always attributing the
 * outlet by name. See docs/RADIO-KHMER.md for the design.
 */

/** A verified media outlet. Content responsibility is theirs, not iAny's — the
 *  app always speaks + shows `outletName` before each item. */
export interface Outlet {
  id: string
  name: string
  verified: boolean
  active: boolean
}

/** One news item as stored/served. `body` is Khmer text; foreign words MUST be
 *  written in Khmer script (enforced at POST) so the voice can pronounce them. */
export interface NewsItem {
  id: string
  outletId: string
  outletName: string
  title: string
  body: string
  /** Word-segmented copies for the TTS voice (server-computed at post time via
   *  ICU). Read aloud in place of title/body when present; display still uses
   *  the clean title/body. Absent on old rows → the voice falls back to them. */
  ttsTitle?: string
  ttsBody?: string
  /** Optional short sponsor line; the app labels it "ឧបត្ថម្ភដោយ / Sponsored". */
  sponsor?: string
  lang: 'km' | 'en'
  createdAt: string
  /** Items past this are purged by the daily cron (default: createdAt + 7 days). */
  expiresAt: string
}

/** What an outlet sends to POST /radio/news (server fills id/outlet/expiry). */
export interface NewsSubmission {
  title: string
  body: string
  sponsor?: string
  lang?: 'km' | 'en'
}

/** GET /radio/feed?since=<cursor> response. `cursor` feeds the next poll. */
export interface RadioFeed {
  items: NewsItem[]
  cursor: string
}

/** Length + content limits, shared so client and server agree. */
export const RADIO_LIMITS = {
  titleMax: 200,
  bodyMax: 1500,
  sponsorMax: 200,
  /** Reject a post whose body has more Latin letters than this — nudges outlets
   *  to transliterate foreign words into Khmer script (TTS can't say Latin). */
  maxLatinLetters: 8,
  ttlDays: 7,
} as const

/** True if `body` obeys the "write foreign words in Khmer script" rule. */
export function withinLatinBudget(body: string): boolean {
  const latin = (body.match(/[A-Za-z]/g) ?? []).length
  return latin <= RADIO_LIMITS.maxLatinLetters
}

/** The spoken form of an item: outlet name FIRST (attribution), then title,
 *  body, and a labeled sponsor. Identical on every platform. */
export function attributedText(item: NewsItem): string {
  // Prefer the word-segmented copies (better pronunciation); fall back to the
  // display text for old items that predate segmentation.
  const title = item.ttsTitle || item.title
  const body = item.ttsBody || item.body
  let t = `ព័ត៌មានពី ${item.outletName}។ ${title}។ ${body}`
  if (item.sponsor && item.sponsor.trim()) t += ` ឧបត្ថម្ភដោយ ${item.sponsor.trim()}។`
  return t
}

/* ------------------------------------------------------------------ *
 * Shared radio PLAYER. Platform I/O is injected — a `RadioTts` (the   *
 * on-device voice) and a `fetchFeed` (HTTP) — so the queue + polling  *
 * + pause/skip logic is written ONCE and reused by the PWA and mobile.*
 * ------------------------------------------------------------------ */

export interface RadioTts {
  readonly ready: boolean
  init(): Promise<void>
  speak(text: string): Promise<void>
  stop(): Promise<void> | void
}

export type RadioState = 'idle' | 'loading' | 'playing' | 'paused' | 'waiting' | 'error'

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export class RadioPlayer {
  state: RadioState = 'idle'
  current: NewsItem | null = null
  error = ''
  private queue: NewsItem[] = []
  private seen = new Set<string>()
  /** Every item fetched this session (for the browsable "today" list). */
  private itemsById = new Map<string, NewsItem>()
  private cursor = ''
  private runId = 0
  private cancelCurrent: (() => void) | null = null
  private wake: (() => void) | null = null
  private listeners = new Set<() => void>()
  private readonly tts: RadioTts
  private readonly fetchFeed: (since: string) => Promise<RadioFeed>
  private readonly pollMs: number

  constructor(opts: {
    tts: RadioTts
    fetchFeed: (since: string) => Promise<RadioFeed>
    pollMs?: number
  }) {
    this.tts = opts.tts
    this.fetchFeed = opts.fetchFeed
    this.pollMs = opts.pollMs ?? 20000
  }

  /** Subscribe for re-render; returns an unsubscribe. Bound for useSyncExternalStore. */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() {
    this.listeners.forEach((f) => f())
  }
  private set(state: RadioState, error = '') {
    this.state = state
    this.error = error
    this.emit()
  }

  /** Pull new items (server is newest-first); queue oldest-first so the bulletin
   *  reads chronologically. Returns how many fresh items were added. */
  private async fill(): Promise<number> {
    const data = await this.fetchFeed(this.cursor)
    const items = data.items ?? []
    for (const i of items) this.itemsById.set(i.id, i) // keep for the browse list
    const fresh = items.filter((i) => !this.seen.has(i.id))
    for (const i of [...fresh].reverse()) {
      this.seen.add(i.id)
      this.queue.push(i)
    }
    if (data.cursor) this.cursor = data.cursor
    return fresh.length
  }

  /** Today's news (local day), newest first — for the "listen again" list. */
  get todayItems(): NewsItem[] {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return [...this.itemsById.values()]
      .filter((i) => new Date(i.createdAt).getTime() >= start.getTime())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Load the feed without starting playback (so the list shows before play). */
  async refresh(): Promise<void> {
    try {
      await this.fill()
      this.emit()
    } catch (e) {
      this.set('error', errMsg(e))
    }
  }

  /** Play a specific item now (replay from the list). Continues the bulletin
   *  with the rest afterward. */
  async playItem(item: NewsItem): Promise<void> {
    this.itemsById.set(item.id, item)
    this.queue.unshift(item)
    if (this.state === 'playing') {
      this.skip() // cancel current; the loop picks up the item we just unshifted
    } else {
      await this.start()
    }
  }

  async start(): Promise<void> {
    if (this.state === 'playing' || this.state === 'loading') return
    const my = ++this.runId
    if (!this.tts.ready) {
      this.set('loading')
      try {
        await this.tts.init()
      } catch (e) {
        this.set('error', errMsg(e))
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
          const n = await this.fill()
          if (my !== this.runId) return
          if (n === 0) {
            this.set('waiting')
            await this.sleep(this.pollMs)
            continue
          }
          this.set('playing')
        } catch (e) {
          this.set('error', errMsg(e))
          await this.sleep(this.pollMs)
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

  /** Speak one item, resolving early if paused/skipped (so the loop never hangs). */
  private speakCancelable(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.cancelCurrent = resolve
      Promise.resolve(this.tts.speak(text)).then(
        () => resolve(),
        () => resolve(),
      )
    }).finally(() => {
      this.cancelCurrent = null
    })
  }

  /** Cancelable wait — pause/stop call `wake` to break it immediately. */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wake = resolve
      setTimeout(() => {
        this.wake = null
        resolve()
      }, ms)
    })
  }

  skip(): void {
    this.cancelCurrent?.()
    void this.tts.stop()
  }

  pause(): void {
    this.runId++
    this.cancelCurrent?.()
    this.wake?.()
    void this.tts.stop()
    if (this.current) this.queue.unshift(this.current) // replay current on resume
    this.set('paused')
  }

  async resume(): Promise<void> {
    await this.start()
  }

  stop(): void {
    this.runId++
    this.cancelCurrent?.()
    this.wake?.()
    void this.tts.stop()
    this.current = null
    this.queue = []
    this.set('idle')
  }
}
