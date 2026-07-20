/**
 * Labels for the /health-test collector — rapid diagnostic test (RDT) strips.
 *
 * IMPORTANT SCOPE (see docs/HEALTH-AI.md): the *test* is the validated medical
 * device; a model trained from this data only READS the result line from a photo
 * (positive / negative / invalid). This is reading, not diagnosing. We collect the
 * strip photo + its result — never faces, names, or any identifying document.
 *
 * `result` is the classifier target; `test` is metadata to stratify by kit type.
 */

export interface HealthLabel {
  id: string
  emoji: string
  en: string
  km: string
}

export const TEST_TYPES: HealthLabel[] = [
  { id: 'malaria', emoji: '🦟', en: 'Malaria', km: 'គ្រុនចាញ់' },
  { id: 'dengue', emoji: '🩸', en: 'Dengue', km: 'គ្រុនឈាម' },
  { id: 'pregnancy', emoji: '🤰', en: 'Pregnancy', km: 'ការមានផ្ទៃពោះ' },
  { id: 'covid', emoji: '🦠', en: 'COVID-19', km: 'កូវីដ-១៩' },
  { id: 'other', emoji: '🧪', en: 'Other test', km: 'តេស្តផ្សេង' },
]

export const RESULTS: HealthLabel[] = [
  { id: 'positive', emoji: '➕', en: 'Positive', km: 'វិជ្ជមាន' },
  { id: 'negative', emoji: '➖', en: 'Negative', km: 'អវិជ្ជមាន' },
  { id: 'invalid', emoji: '⚠️', en: 'Invalid / unclear', km: 'មិនត្រឹមត្រូវ / មិនច្បាស់' },
]

export const TEST_BY_ID = Object.fromEntries(TEST_TYPES.map((c) => [c.id, c]))
export const RESULT_BY_ID = Object.fromEntries(RESULTS.map((c) => [c.id, c]))
