import type { Classification } from './imageClassifier'

/**
 * Map a generic ImageNet classifier's output to one of our /waste material types.
 *
 * We don't have a purpose-trained waste model yet — the /waste collector is
 * gathering that data. In the meantime the LIVE view runs MediaPipe's pretrained
 * EfficientNet-Lite (ImageNet, Apache-2.0) and we translate its 1000-class labels
 * into our 8 material types by keyword. It's a rough BETA guess, shown as a
 * suggestion the user confirms — never an authoritative result. When the trained
 * model lands, swap the model URL and collapse this to a passthrough — full recipe
 * + deploy steps in docs/WASTE-MODEL.md. See also docs/ENVIRONMENT-AI.md.
 */

// Each waste type → substrings that appear in relevant ImageNet labels.
// First matching type wins (ordered most- to least-specific).
const KEYWORDS: [string, string[]][] = [
  ['plastic_bottle', ['water bottle', 'pop bottle', 'soda bottle', 'pill bottle', 'water jug', 'plastic bottle']],
  ['glass', ['beer bottle', 'wine bottle', 'beer glass', 'goblet', 'wine glass', 'vase', 'jar']],
  ['can', ['tin can', 'milk can', 'beer can', 'soda can', 'canister', ' can']],
  ['paper', ['carton', 'envelope', 'paper towel', 'toilet tissue', 'notebook', 'book jacket', 'menu', 'packet', 'cardboard']],
  ['ewaste', ['cellular', 'cellphone', 'mobile phone', 'ipod', 'laptop', 'remote control', 'battery', 'hard disc', 'modem', 'monitor']],
  ['plastic_other', ['plastic bag', 'shopping bag', 'trash bag', 'sunscreen', 'lotion', 'shampoo', 'plastic']],
  ['organic', [
    'banana', 'orange', 'lemon', 'pineapple', 'pomegranate', 'fig', 'strawberry',
    'corn', 'cucumber', 'broccoli', 'cabbage', 'mushroom', 'bell pepper', 'artichoke',
    'granny smith', 'cauliflower', 'zucchini', 'squash', 'ear',
  ]],
]

export interface WasteGuess {
  typeId: string
  /** Confidence 0..1 from the underlying classifier. */
  conf: number
}

/**
 * Best waste-type guess from a ranked classifier result, or null if nothing maps
 * or confidence is too low. `minConf` guards against confident-nonsense on empty
 * frames.
 */
export function guessWasteType(results: Classification[], minConf = 0.18): WasteGuess | null {
  for (const r of results) {
    if (r.score < minConf) continue
    const label = r.label.toLowerCase()
    for (const [typeId, keys] of KEYWORDS) {
      if (keys.some((k) => label.includes(k))) return { typeId, conf: r.score }
    }
  }
  return null
}
