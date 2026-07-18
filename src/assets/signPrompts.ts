/**
 * Starter prompts for the "Contribute Khmer Sign Language" screen (/sign).
 *
 * A contributor is shown one label at a time and signs it to the camera; the
 * on-device hand tracker records the gesture as a short landmark sequence (no
 * video). Each (label, gesture) pair becomes one training example for an open
 * Khmer Sign Language recognition model.
 *
 * This is a STARTER vocabulary — a small, high-frequency set so the first model
 * can recognise something useful: the fingerspelling alphabet, digits, and
 * common everyday words. Khmer Sign Language (KSL) is a real, living language of
 * the Deaf community; the *authoritative* sign for each label comes from the
 * contributors, not from us. A teacher or a Deaf-community partner can extend or
 * correct this list — see docs/SIGN-COLLECTION.md. Keep labels short and common.
 */

export interface SignPrompt {
  /** Stable id (never renumber — it links a recording to its label). */
  id: string
  /** The Khmer label to sign. */
  km: string
  /** A short English gloss, shown as a helper. */
  en: string
}

/** Grouped only for authoring clarity; the app flattens the list. */
const GROUPS: Record<string, [string, string][]> = {
  // Fingerspelling — the Khmer manual alphabet (consonants).
  letter: [
    ['ក', 'ka'], ['ខ', 'kha'], ['គ', 'ko'], ['ឃ', 'kho'], ['ង', 'ngo'],
    ['ច', 'cha'], ['ឆ', 'chha'], ['ជ', 'cho'], ['ឈ', 'chho'], ['ញ', 'nyo'],
    ['ដ', 'da'], ['ឋ', 'ttha'], ['ឌ', 'do'], ['ឍ', 'ttho'], ['ណ', 'na'],
    ['ត', 'ta'], ['ថ', 'tha'], ['ទ', 'to'], ['ធ', 'tho'], ['ន', 'no'],
    ['ប', 'ba'], ['ផ', 'pha'], ['ព', 'po'], ['ភ', 'pho'], ['ម', 'mo'],
    ['យ', 'yo'], ['រ', 'ro'], ['ល', 'lo'], ['វ', 'vo'],
    ['ស', 'sa'], ['ហ', 'ha'], ['ឡ', 'la'], ['អ', 'qa'],
  ],
  // Digits 0–9.
  number: [
    ['០', 'zero'], ['១', 'one'], ['២', 'two'], ['៣', 'three'], ['៤', 'four'],
    ['៥', 'five'], ['៦', 'six'], ['៧', 'seven'], ['៨', 'eight'], ['៩', 'nine'],
  ],
  // Everyday words — greetings, courtesy, questions.
  common: [
    ['សួស្ដី', 'hello'],
    ['អរគុណ', 'thank you'],
    ['សូមទោស', 'sorry'],
    ['បាទ/ចាស', 'yes'],
    ['ទេ', 'no'],
    ['សូម', 'please'],
    ['ជម្រាបលា', 'goodbye'],
    ['ស្រឡាញ់', 'love'],
    ['ជួយ', 'help'],
    ['ឈ្មោះ', 'name'],
    ['អ្វី', 'what'],
    ['ណា', 'where'],
    ['ពេលណា', 'when'],
    ['ហេតុអ្វី', 'why'],
    ['យ៉ាងម៉េច', 'how'],
  ],
  // People & family.
  family: [
    ['ម្ដាយ', 'mother'],
    ['ឪពុក', 'father'],
    ['បង', 'older sibling'],
    ['ប្អូន', 'younger sibling'],
    ['គ្រួសារ', 'family'],
    ['មិត្ត', 'friend'],
    ['គ្រូ', 'teacher'],
    ['សិស្ស', 'student'],
  ],
  // Common everyday things & actions.
  daily: [
    ['ទឹក', 'water'],
    ['បាយ', 'rice / food'],
    ['ផ្ទះ', 'home'],
    ['សាលា', 'school'],
    ['សៀវភៅ', 'book'],
    ['ការងារ', 'work'],
    ['ថ្ងៃ', 'day'],
    ['ពេលវេលា', 'time'],
    ['ល្អ', 'good'],
    ['ស្អាត', 'beautiful / clean'],
    ['ញ៉ាំ', 'eat'],
    ['ផឹក', 'drink'],
    ['ដើរ', 'walk'],
    ['រៀន', 'learn'],
  ],
}

/** Flat, ordered list with stable ids like `letter-01`. */
export const SIGN_PROMPTS: SignPrompt[] = Object.entries(GROUPS).flatMap(([group, items]) =>
  items.map(([km, en], i) => ({ id: `${group}-${String(i + 1).padStart(2, '0')}`, km, en })),
)

export const SIGN_PROMPT_COUNT = SIGN_PROMPTS.length
