/**
 * Labels for the /waste collector — waste / recyclable material types.
 *
 * A model trained from this data classifies an item's material (plastic bottle,
 * can, glass, …) on-device, offline — for recycling education, correct sorting,
 * and to help the informal waste-buyer economy know what has resale value. Lower
 * risk than the health/water tools (no safety failure mode) and easy to bootstrap
 * with public datasets (TrashNet / TACO). See docs/ENVIRONMENT-AI.md.
 *
 * `type` is the classifier target. `recyclable` is a hint the app can show; the
 * truth depends on local facilities, so treat it as guidance.
 */

export interface WasteLabel {
  id: string
  emoji: string
  en: string
  km: string
  /** Usually recyclable where facilities exist (a hint, not a guarantee). */
  recyclable?: boolean
}

export const WASTE_TYPES: WasteLabel[] = [
  { id: 'plastic_bottle', emoji: '🍾', en: 'Plastic bottle (PET)', km: 'ដបផ្លាស្ទិច', recyclable: true },
  { id: 'plastic_other', emoji: '🛍️', en: 'Other plastic / bag', km: 'ផ្លាស្ទិចផ្សេង / ថង់' },
  { id: 'can', emoji: '🥫', en: 'Can / metal', km: 'កំប៉ុង / ដែក', recyclable: true },
  { id: 'glass', emoji: '🍶', en: 'Glass', km: 'កែវ', recyclable: true },
  { id: 'paper', emoji: '📄', en: 'Paper / cardboard', km: 'ក្រដាស / ក្រដាសកាតុង', recyclable: true },
  { id: 'organic', emoji: '🍂', en: 'Organic / food', km: 'សរីរាង្គ / អាហារ' },
  { id: 'ewaste', emoji: '🔋', en: 'E-waste / battery', km: 'អេឡិចត្រូនិច / ថ្ម' },
  { id: 'other', emoji: '🗑️', en: 'Other / general', km: 'ផ្សេង / ទូទៅ' },
]

export const WASTE_BY_ID = Object.fromEntries(WASTE_TYPES.map((c) => [c.id, c]))
