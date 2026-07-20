import type { Classification } from './imageClassifier'
import { WASTE_BY_ID } from '../assets/wasteLabels'

/**
 * Turn the on-device waste model's output into a guess. The model
 * (docs/WASTE-MODEL.md, run via src/lib/wasteOnnx.ts) already outputs OUR material
 * type ids (can / glass / paper / …), so this is just the top prediction above a
 * confidence floor — no keyword mapping. Shown as a suggestion the user confirms.
 */

export interface WasteGuess {
  typeId: string
  /** Confidence 0..1 (softmax probability). */
  conf: number
}

/** Top prediction if it's a known waste type and confident enough, else null. */
export function guessWasteType(results: Classification[], minConf = 0.5): WasteGuess | null {
  const top = results[0]
  if (top && top.score >= minConf && WASTE_BY_ID[top.label]) {
    return { typeId: top.label, conf: top.score }
  }
  return null
}
