/**
 * Khmer → Braille conversion (offline, no ML).
 *
 * Turns Khmer text (e.g. from OCR, the Library, or a chat answer) into:
 *  - **Unicode Braille** dots (U+2800–28FF) for on-screen display, and
 *  - **BRF / Braille-ASCII** for embossers and refreshable displays.
 *
 * Pipeline: tokenize into orthographic syllables → reorder pre-base vowels and
 * coeng-រ → merge composite vowels → map each glyph to a Braille cell.
 *
 * This is an independent iAny implementation. The character→cell mapping follows
 * the Khmer Braille standard; the algorithm was reimplemented from the approach
 * in IDRI-LAB/Khmer-Braille-Translation (used only as a reference — its repo
 * carries no license, so no code was copied). The mapping should be verified
 * against the official Khmer Braille chart (Krousar Thmey / MoEYS) before any
 * production embossing.
 */

/* eslint-disable */
// Khmer glyph / character → Braille-ASCII (BRF) codes. Composite vowels and a
// few multi-char keys are handled by the combine step below.
export const KHMER_TO_BRF: Record<string, string> = {
  '0': 'j', '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e', '6': 'f', '7': 'g', '8': 'h', '9': 'i',
  'ក': 'g', 'ខ': 'k', 'គ': ',g', 'ឃ': ',k', 'ង': ']', 'ច': 'j', 'ឆ': '+', 'ជ': ',j', 'ឈ': ',+',
  'ញ': ',?', 'ដ': 'd', 'ឋ': '-)', 'ឌ': ',d', 'ឍ': '0)', 'ណ': 'n', 'ត': 't', 'ថ': ')', 'ទ': ',t',
  'ធ': ',)', 'ន': ',n', 'ប': 'b', 'ផ': 'p', 'ព': '&', 'ភ': ',p', 'ម': 'm', 'យ': ',y', 'រ': 'r',
  'ល': ',l', 'វ': 'w', 'ស': 's', 'ហ': 'h', 'ឡ': 'l', 'អ': 'o',
  'ា': '*', 'ិ': '/', 'ី': 'e', 'ឹ': '[', 'ឺ': '5', 'ុ': 'c', 'ូ': '3', 'ួ': '2', 'ើ': '%',
  'ឿ': 'q', 'ៀ': '(', 'េ': 'f', 'ែ': '<', 'ៃ': 'i', 'ោ': ':', 'ៅ': '_',
  'ុំ': '$', 'ំ': 'y', 'ាំ': 'z', 'ះ': 'a', 'ុះ': 'x', 'េះ': 'u', 'ោះ': '!', 'ែះ': '<a', 'ើះ': '%a',
  'ាះ': '*a', 'អា': 'o*',
  'ឥ': ',/', 'ឦ': 'ea', 'ឧ': 'ca', 'ឩ': ',3', 'ឪ': '\\', 'ឫ': ',x', 'ឬ': 'xa', 'ឭ': '?', 'ឮ': '?a',
  'ឯ': '"', 'ឰ': 'fa', 'ឱ': ':a', 'ឲ': ':a', 'ឳ': '_c',
  '៉': '@', '៊': '-', '៍': '0', '់': '9', '័': '>', '៏': "'", '៌': '7', 'ៈ': '^', 'ៗ': '1',
  '០': 'j', '១': 'a', '២': 'b', '៣': 'c', '៤': 'd', '៥': 'e', '៦': 'f', '៧': 'g', '៨': 'h', '៩': 'i',
  '។ល។': '=,l=', '។': '=', '>': '$.1', '<': '$"k', '?': '8', '!': '6', '=': '.k', '៕': '=,',
  '...': "'''", '{': '.(', '}': '.)', '[': '@(', ']': '@)', '៖': './',
  '': '', '#': '#', '`': '`', ')': '7', '(': '7', '«': '8', '»': '0', '.': '4', '៎': '+', ',': ',',
  ' ': ' ', '\n': '\n', '\t': '\t', '\r': '\r', '​': ' ', '"': 'a', "'": "'", '”': '”', '“': '“',
  a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g', h: 'h', i: 'i', j: 'j', k: 'k', l: 'l',
  m: 'm', n: 'n', o: 'o', p: 'p', q: 'q', r: 'r', s: 's', t: 't', u: 'u', v: 'v', w: 'w', x: 'x',
  y: 'y', z: 'z',
  A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f', G: 'g', H: 'h', I: 'i', J: 'j', K: 'k', L: 'l',
  M: 'm', N: 'n', O: 'o', P: 'p', Q: 'q', R: 'r', S: 's', T: 't', U: 'u', V: 'v', W: 'w', X: 'x',
  Y: 'y', Z: 'z',
}

// Braille-ASCII (BRF) char → Unicode Braille dot pattern (U+2800–28FF).
export const BRF_TO_UNICODE: Record<string, string> = {
  '0': '⠴', '1': '⠂', '2': '⠆', '3': '⠒', '4': '⠲', '5': '⠢', '6': '⠖', '7': '⠶', '8': '⠦', '9': '⠔',
  a: '⠁', b: '⠃', c: '⠉', d: '⠙', e: '⠑', f: '⠋', g: '⠛', h: '⠓', i: '⠊', j: '⠚', k: '⠅', l: '⠇',
  m: '⠍', n: '⠝', o: '⠕', p: '⠏', q: '⠟', r: '⠗', s: '⠎', t: '⠞', u: '⠥', v: '⠧', w: '⠺', x: '⠭',
  y: '⠽', z: '⠵',
  '%': '⠩', '+': '⠬', '=': '⠿', "'": '⠄', ',': '⠠', '-': '⠤', '^': '⠘', '/': '⠌', '"': '⠐',
  '!': '⠮', '?': '⠹', $: '⠫', ':': '⠱', ';': '⠰', '(': '⠷', ')': '⠾', '|': '⠳', ' ': '⠀', '@': '⠈',
  '>': '⠜', '<': '⠣', _: '⠸', '#': '⠼', '[': '⠪', ']': '⠻', '`': '⠈', '{': '⠪', '}': '⠻', '&': '⠯',
  '.': '⠨', '*': '⠡', '\\': '⠳', '“': '…', '”': '‴', '‘': '⠠ ⠄', '’': '⠄',
}
/* eslint-enable */

const COENG = '្'
const RO = 'រ'
const VOWEL_SIGNS = new Set(['េ', 'ែ', 'ៃ', 'ើ']) // pre-base vowels — written first in Braille
// Composite vowels stored as two code points that map to a single Braille cell.
const COMBOS: [string, string, string][] = [
  ['ោ', 'ះ', 'ោះ'],
  ['ុ', 'ះ', 'ុះ'],
  ['េ', 'ះ', 'េះ'],
  ['ំ', 'ុ', 'ុំ'],
  ['ា', 'ំ', 'ាំ'],
]

const cp = (c: string) => c.codePointAt(0) ?? 0
const isKhmerBase = (c: string) => cp(c) >= 0x1780 && cp(c) <= 0x17b3 // consonants + independent vowels
const isKhmerCombining = (c: string) => cp(c) >= 0x17b6 && cp(c) <= 0x17d3 // vowel signs + diacritics (+ coeng)
const isAsciiLetter = (c: string) => /[A-Za-z]/.test(c)
const isDigit = (c: string) => /[0-9]/.test(c) || (cp(c) >= 0x17e0 && cp(c) <= 0x17e9)

/** Split into tokens: Khmer orthographic syllables, Latin words, number runs,
 *  and single other chars. Reordering then works within one syllable. */
function tokenize(text: string): string[] {
  const chars = Array.from(text)
  const tokens: string[] = []
  let i = 0
  while (i < chars.length) {
    const c = chars[i]!
    if (isKhmerBase(c)) {
      let j = i + 1
      while (j < chars.length) {
        const d = chars[j]!
        if (d === COENG) {
          j++
          if (j < chars.length && isKhmerBase(chars[j]!)) j++ // subscript consonant
        } else if (isKhmerCombining(d)) {
          j++
        } else break
      }
      tokens.push(chars.slice(i, j).join(''))
      i = j
    } else if (isAsciiLetter(c)) {
      let j = i + 1
      while (j < chars.length && isAsciiLetter(chars[j]!)) j++
      tokens.push(chars.slice(i, j).join(''))
      i = j
    } else if (isDigit(c)) {
      let j = i + 1
      while (j < chars.length && (isDigit(chars[j]!) || (chars[j] === '.' && isDigit(chars[j + 1] ?? '')))) j++
      tokens.push(chars.slice(i, j).join(''))
      i = j
    } else {
      tokens.push(c)
      i++
    }
  }
  return tokens
}

/** Number / capitalization markers, applied per token (before reordering). */
function markToken(token: string): string {
  if (token && Array.from(token).every(isDigit)) return `#${token}` // number sign
  if (isAsciiLetter(token[0] ?? '')) {
    if (token.length >= 2 && token === token.toUpperCase() && token !== token.toLowerCase()) {
      return `,,${token.toLowerCase()}` // all-caps word
    }
    return Array.from(token) // capital sign before each uppercase
      .map((c) => (c !== c.toLowerCase() && c === c.toUpperCase() ? ',' + c.toLowerCase() : c))
      .join('')
  }
  return token
}

/** Move a pre-base vowel sign and/or coeng-រ to the front of the syllable. */
function reorder(token: string): string[] {
  const chars = Array.from(token)
  const vi = chars.findIndex((c) => VOWEL_SIGNS.has(c))
  let cr: [number, number] | null = null
  for (let i = 0; i < chars.length - 1; i++) {
    if (chars[i] === COENG && chars[i + 1] === RO) {
      cr = [i, i + 1]
      break
    }
  }
  const front: string[] = []
  const used = new Set<number>()
  if (vi >= 0 && cr) {
    front.push(chars[vi]!)
    used.add(vi)
    front.push(chars[cr[0]]!, chars[cr[1]]!)
    used.add(cr[0]).add(cr[1])
  } else if (cr) {
    front.push(chars[cr[0]]!, chars[cr[1]]!)
    used.add(cr[0]).add(cr[1])
  } else if (vi >= 0) {
    front.push(chars[vi]!)
    used.add(vi)
  }
  for (let i = 0; i < chars.length; i++) if (!used.has(i)) front.push(chars[i]!)
  return front
}

/** Merge two-code-point composite vowels into their single-cell form. */
function combine(chars: string[]): string[] {
  const out = [...chars]
  for (const [a, b, combo] of COMBOS) {
    const ia = out.indexOf(a)
    const ib = out.indexOf(b)
    if (ia >= 0 && ib >= 0) {
      const first = Math.max(ia, ib)
      const second = Math.min(ia, ib)
      out.splice(first, 1)
      out.splice(second, 1)
      out.push(combo)
    }
  }
  return out
}

/** Khmer text → BRF / Braille-ASCII string (for .brf files + embossers). */
export function khmerToBrf(text: string): string {
  let brf = ''
  for (const token of tokenize(text)) {
    const chars = combine(reorder(markToken(token)))
    for (const c of chars) {
      const key = c === COENG ? 'v' : c
      brf += KHMER_TO_BRF[key] ?? ''
    }
  }
  return brf
}

/** BRF / Braille-ASCII → Unicode Braille dots (for display). */
export function brfToUnicodeBraille(brf: string): string {
  let out = ''
  for (const c of brf) {
    if (c === '\n' || c === '\r' || c === '\t') out += c
    else out += BRF_TO_UNICODE[c] ?? ''
  }
  return out
}

/** Khmer text → Unicode Braille dots (U+2800–28FF), ready to display. */
export function khmerToBraille(text: string): string {
  return brfToUnicodeBraille(khmerToBrf(text))
}
