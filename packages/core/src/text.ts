/**
 * Khmer-aware text utilities shared by both apps. Khmer has no spaces between
 * words and its own sentence punctuation (។), so naive splitting fails. Keeping
 * these here means the PWA and mobile chunk documents IDENTICALLY (pack
 * portability) and speak numbers the SAME way (one TTS behaviour).
 */

import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_SENTENCES } from './types'

/** Sentence terminators: Khmer khan (។) + Latin . ! ? and newlines. Split keeps
 *  the terminator attached (lookbehind) so text isn't lost. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[។!?.\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Chunk a document into overlapping, sentence-aligned windows. Identical output
 * on every platform is the whole point — the same doc must produce the same
 * chunks so embeddings and packs line up.
 */
export function chunkText(
  content: string,
  maxChars: number = CHUNK_MAX_CHARS,
  overlapSentences: number = CHUNK_OVERLAP_SENTENCES,
): string[] {
  const sentences = splitSentences(content)
  if (sentences.length === 0) return []
  const chunks: string[] = []
  let cur: string[] = []
  let curLen = 0
  for (const s of sentences) {
    if (curLen + s.length > maxChars && cur.length > 0) {
      chunks.push(cur.join(' '))
      cur = overlapSentences > 0 ? cur.slice(-overlapSentences) : []
      curLen = cur.reduce((n, x) => n + x.length + 1, 0)
    }
    cur.push(s)
    curLen += s.length + 1
  }
  if (cur.length > 0) chunks.push(cur.join(' '))
  return chunks
}

/* ------------------------------------------------------------------ *
 * Khmer number → words. TTS voices trained on Khmer speech can't say  *
 * digits; spell them out before synthesis. Speech-only — display text *
 * keeps its digits.                                                   *
 * ------------------------------------------------------------------ */

const KH_UNITS = ['សូន្យ', 'មួយ', 'ពីរ', 'បី', 'បួន', 'ប្រាំ', 'ប្រាំមួយ', 'ប្រាំពីរ', 'ប្រាំបី', 'ប្រាំបួន']
const KH_TENS = ['', 'ដប់', 'ម្ភៃ', 'សាមសិប', 'សែសិប', 'ហាសិប', 'ហុកសិប', 'ចិតសិប', 'ប៉ែតសិប', 'កៅសិប']
const KH_SCALES: [number, string][] = [
  [1000000, 'លាន'],
  [100000, 'សែន'],
  [10000, 'ម៉ឺន'],
  [1000, 'ពាន់'],
  [100, 'រយ'],
]

/** Non-negative integer -> Khmer words (handles the លាន/សែន/ម៉ឺន scale system). */
export function intToKhmer(n: number): string {
  if (n === 0) return KH_UNITS[0]
  if (n < 10) return KH_UNITS[n]
  if (n < 20) return 'ដប់' + (n > 10 ? KH_UNITS[n - 10] : '')
  if (n < 100) {
    const t = Math.floor(n / 10)
    const u = n % 10
    return KH_TENS[t] + (u ? KH_UNITS[u] : '')
  }
  for (const [pv, word] of KH_SCALES) {
    if (n >= pv) {
      const hi = Math.floor(n / pv)
      const lo = n % pv
      return intToKhmer(hi) + word + (lo ? intToKhmer(lo) : '')
    }
  }
  return ''
}

/** Replace digit runs (Arabic or Khmer, with , separators / . decimals) with
 *  Khmer number words so a Khmer voice can pronounce them. */
export function normalizeNumbers(text: string): string {
  const ascii = text.replace(/[០-៩]/g, (d) => String(d.charCodeAt(0) - 0x17e0))
  return ascii.replace(/\d+(?:,\d{3})*(?:\.\d+)?/g, (m) => {
    const [intPart, frac] = m.replace(/,/g, '').split('.')
    const n = parseInt(intPart, 10)
    if (!Number.isFinite(n)) return m
    let words = intToKhmer(n)
    if (frac) {
      words += ' ចុច ' + [...frac].map((d) => KH_UNITS[parseInt(d, 10)] ?? '').join(' ')
    }
    return ` ${words} `
  })
}
