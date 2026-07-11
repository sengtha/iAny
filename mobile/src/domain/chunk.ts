import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_SENTENCES } from './types'

const KHMER_RE = /[ក-៿]/

export function detectLang(text: string): 'km' | 'en' {
  return KHMER_RE.test(text) ? 'km' : 'en'
}

/**
 * Sentence splitting WITHOUT Intl.Segmenter — React Native's Hermes engine
 * does not ship it. We split on Latin sentence enders and the Khmer khan (។)
 * / bariyoosan (៕). Khmer rarely puts a space after the khan, so unlike the
 * PWA fallback we do not require trailing whitespace.
 *
 * This is coarser than ICU dictionary segmentation, but chunk boundaries only
 * need to be *reasonable* — retrieval quality comes from the embeddings and
 * FTS, not from perfect sentence splitting.
 */
export function segmentSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?។៕])/)
    .flatMap((s) => s.split(/\n{2,}/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export interface TextChunk {
  seq: number
  text: string
}

/**
 * Sentence-packing chunker: fill up to maxChars, carry the last
 * `overlapSentences` sentences into the next chunk for context continuity.
 * Paragraph boundaries are respected first so chunks don't stitch unrelated
 * sections together. Ported from the PWA (src/ai/chunker.ts); the only change
 * is the segmenter (see segmentSentences).
 *
 * Native has no `tokens` column: FTS5's trigram tokenizer indexes the raw
 * chunk text and works on spaceless Khmer directly, so pre-segmented word
 * tokens are unnecessary.
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
    if (currentLen > maxChars * 0.6) flush()
  }
  if (current.join(' ').trim().length > 0) flush()

  return chunks
    .filter((c, i) => c.length > 0 && chunks.indexOf(c) === i)
    .map((text, seq) => ({ seq, text }))
}
