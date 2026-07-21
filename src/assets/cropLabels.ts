/**
 * The label taxonomy for the /crop collector — Cambodia's common crops and a few
 * broad plant-health conditions. A contributor picks a crop + a condition (and an
 * optional note); each photo joins an open dataset for training an offline
 * crop-health classifier (MobileNetV3 — see docs/VISION-MOBILENET.md).
 *
 * We keep conditions BROAD on purpose: a farmer knows "healthy" vs "something's
 * wrong (disease / pest / deficiency)" even without the exact disease name. Expert
 * labellers can refine the fine-grained class later; coarse-but-honest labels from
 * many real fields are more valuable than precise-but-guessed ones.
 */

export interface CropLabel {
  id: string
  emoji: string
  en: string
  km: string
}

export const CROPS: CropLabel[] = [
  { id: 'rice', emoji: '🌾', en: 'Rice', km: 'ស្រូវ' },
  { id: 'cassava', emoji: '🥔', en: 'Cassava', km: 'ដំឡូងមី' },
  { id: 'maize', emoji: '🌽', en: 'Maize / corn', km: 'ពោត' },
  { id: 'banana', emoji: '🍌', en: 'Banana', km: 'ចេក' },
  { id: 'mango', emoji: '🥭', en: 'Mango', km: 'ស្វាយ' },
  { id: 'cashew', emoji: '🥜', en: 'Cashew', km: 'ស្វាយចន្ទី' },
  { id: 'vegetable', emoji: '🥬', en: 'Vegetable', km: 'បន្លែ' },
  { id: 'chili', emoji: '🌶️', en: 'Chili', km: 'ម្ទេស' },
  { id: 'pepper', emoji: '⚫', en: 'Pepper (black)', km: 'ម្រេច' },
  { id: 'bean', emoji: '🫘', en: 'Bean', km: 'សណ្ដែក' },
  { id: 'sugarcane', emoji: '🎋', en: 'Sugarcane', km: 'អំពៅ' },
  { id: 'rubber', emoji: '🌳', en: 'Rubber', km: 'កៅស៊ូ' },
  { id: 'other', emoji: '🌱', en: 'Other', km: 'ផ្សេងៗ' },
]

export const CONDITIONS: CropLabel[] = [
  { id: 'healthy', emoji: '✅', en: 'Healthy', km: 'មានសុខភាពល្អ' },
  { id: 'disease', emoji: '🦠', en: 'Disease', km: 'ជំងឺ' },
  { id: 'pest', emoji: '🐛', en: 'Pest damage', km: 'សត្វល្អិតបំផ្លាញ' },
  { id: 'deficiency', emoji: '🍂', en: 'Nutrient deficiency', km: 'ខ្វះជីជាតិ' },
  { id: 'unsure', emoji: '❓', en: 'Not sure', km: 'មិនច្បាស់' },
]

export const CROP_BY_ID = Object.fromEntries(CROPS.map((c) => [c.id, c]))
export const CONDITION_BY_ID = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]))
