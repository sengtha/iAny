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
