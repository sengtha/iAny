import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_SENTENCES } from '../types'

const KHMER_RE = /[ក-៿]/

export function detectLang(text: string): 'km' | 'en' {
  return KHMER_RE.test(text) ? 'km' : 'en'
}

/**
 * Khmer is written without spaces between words. Intl.Segmenter ships an
 * ICU dictionary-based segmenter for Khmer, which gives us both sentence
 * splitting for chunking and word splitting for keyword search — no server,
 * no extra model.
 */
export function segmentSentences(text: string): string[] {
  const lang = detectLang(text)
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(lang, { granularity: 'sentence' })
    return Array.from(seg.segment(text), (s) => s.segment).filter((s) => s.trim().length > 0)
  }
  // Fallback: split on Latin sentence enders and the Khmer khan (។).
  return text.split(/(?<=[.!?។])\s+/).filter((s) => s.trim().length > 0)
}

/** Space-joined lowercase word tokens, for the FTS 'simple' index. */
export function tokenizeForSearch(text: string): string {
  const lang = detectLang(text)
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(lang, { granularity: 'word' })
    return Array.from(seg.segment(text))
      .filter((s) => s.isWordLike)
      .map((s) => s.segment.toLowerCase())
      .join(' ')
  }
  return text.toLowerCase()
}

export interface TextChunk {
  seq: number
  text: string
  tokens: string
}

/**
 * Sentence-packing chunker: fill up to maxChars, carry the last
 * `overlapSentences` sentences into the next chunk for context continuity.
 * Paragraph boundaries are respected first so chunks don't stitch unrelated
 * sections together.
 */
export function chunkText(
  text: string,
  maxChars = CHUNK_MAX_CHARS,
  overlapSentences = CHUNK_OVERLAP_SENTENCES,
): TextChunk[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  const chunks: string[] = []
  let current: string[] = []
  let currentLen = 0

  const flush = () => {
    if (current.length === 0) return
    chunks.push(current.join(' ').trim())
    const overlap = current.slice(-overlapSentences)
    current = overlapSentences > 0 ? [...overlap] : []
    currentLen = current.reduce((n, s) => n + s.length, 0)
  }

  for (const para of paragraphs) {
    for (const sentence of segmentSentences(para)) {
      // A single sentence longer than maxChars gets hard-split.
      if (sentence.length > maxChars) {
        flush()
        for (let i = 0; i < sentence.length; i += maxChars) {
          chunks.push(sentence.slice(i, i + maxChars).trim())
        }
        current = []
        currentLen = 0
        continue
      }
      if (currentLen + sentence.length > maxChars) flush()
      current.push(sentence)
      currentLen += sentence.length
    }
    // Prefer paragraph boundaries: close the chunk when the paragraph ends
    // if it is already reasonably full.
    if (currentLen > maxChars * 0.6) flush()
  }
  if (current.join(' ').trim().length > 0) flush()

  return chunks
    .filter((c, i) => c.length > 0 && chunks.indexOf(c) === i)
    .map((text, seq) => ({ seq, text, tokens: tokenizeForSearch(text) }))
}
