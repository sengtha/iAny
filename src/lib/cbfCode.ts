/**
 * Parse the Cambodian product-registration code — the "ច.ប.ផ NNNNN/YY" mark
 * printed on packaged goods (e.g. `ច.ប.ផ 30214/23`) — out of OCR text.
 *
 * No model of its own: run the app's Khmer OCR on a label photo, then pull the
 * code out of the recognized text with this parser. Two strategies, most reliable
 * first: (1) a number sitting right after the ច.ប.ផ badge; (2) a bare NNNNN/YY
 * pattern anywhere (the Khmer badge letters often OCR poorly, the digits don't).
 * See docs — this is the "detect-then-read" idea done with existing OCR.
 */

const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩'

/** Convert any Khmer numerals (០–៩) to Arabic so the regex is digit-agnostic. */
function normDigits(s: string): string {
  return s.replace(/[០-៩]/g, (d) => String(KHMER_DIGITS.indexOf(d)))
}

// Registration number: 3–6 digits, a slash, a 2-digit year. Spaces tolerated
// around the slash (OCR sometimes inserts them). Two guards keep out look-alikes:
//   • ≥3 leading digits ⇒ a plain DD/MM date can't match;
//   • the year is NOT followed by another digit ⇒ a phone number written
//     "…844 / 099 606 037" won't match (09 is followed by 9).
// (No look-behind — older iOS Safari throws on it at parse time.)
const NUMBER_RE = /(\d{3,6})\s*\/\s*(\d{2})(?!\d)/
// The ច.ប.ផ badge with optional dots/spaces, tolerant of OCR noise.
const BADGE_RE = /ច\s*\.?\s*ប\s*\.?\s*ផ/

export interface CbfResult {
  /** Normalized code, e.g. "30214/23". */
  code: string
  /** How it was found — 'badge' (next to ច.ប.ផ, high confidence) or 'pattern'. */
  method: 'badge' | 'pattern'
  /** The matched substring, for showing context. */
  raw: string
}

/** Best ច.ប.ផ code found in `ocrText`, or null if none. */
export function parseCbfCode(ocrText: string): CbfResult | null {
  if (!ocrText) return null
  const text = normDigits(ocrText)

  // 1) A number directly following the ច.ប.ផ badge — the most reliable signal.
  const badge = BADGE_RE.exec(text)
  if (badge) {
    const start = badge.index + badge[0].length
    const window = text.slice(start, start + 24)
    const m = NUMBER_RE.exec(window)
    if (m) {
      return {
        code: `${m[1]}/${m[2]}`,
        method: 'badge',
        raw: `${badge[0]} ${window.slice(0, m.index + m[0].length)}`.replace(/\s+/g, ' ').trim(),
      }
    }
  }

  // 2) Fallback: any NNNNN/YY pattern in the text.
  const m = NUMBER_RE.exec(text)
  if (m) return { code: `${m[1]}/${m[2]}`, method: 'pattern', raw: m[0] }

  return null
}
