/**
 * Labels for the /water collector — colorimetric water-quality test strips.
 *
 * SCOPE (see docs/ENVIRONMENT-AI.md): the *test kit* is the validated device; a
 * model trained from this data only READS the strip's colour → a safety band.
 * It is guidance, not a certified measurement. We collect the strip photo + labels
 * only — no personal info.
 *
 * `level` (safety band) is the classifier target; `test` and `source` are metadata.
 */

export interface WaterLabel {
  id: string
  emoji: string
  en: string
  km: string
}

export const TESTS: WaterLabel[] = [
  { id: 'arsenic', emoji: '☠️', en: 'Arsenic', km: 'អាសេនិច' },
  { id: 'bacteria', emoji: '🦠', en: 'Bacteria (H₂S)', km: 'បាក់តេរី' },
  { id: 'ph', emoji: '⚗️', en: 'pH', km: 'pH' },
  { id: 'chlorine', emoji: '💧', en: 'Chlorine', km: 'គ្លរ' },
  { id: 'nitrate', emoji: '🧫', en: 'Nitrate', km: 'នីត្រាត' },
  { id: 'iron', emoji: '🔩', en: 'Iron / hardness', km: 'ដែក / រឹង' },
  { id: 'other', emoji: '🧪', en: 'Other', km: 'ផ្សេង' },
]

// The actionable safety band a family reads from the kit's colour chart. Kept
// coarse on purpose (safe / treat-it / don't-drink) so it's consistent across kits
// and directly useful — and fail-safe (see docs).
export const LEVELS: WaterLabel[] = [
  { id: 'safe', emoji: '✅', en: 'Safe', km: 'សុវត្ថិភាព' },
  { id: 'caution', emoji: '⚠️', en: 'Caution', km: 'ប្រុងប្រយ័ត្ន' },
  { id: 'unsafe', emoji: '❌', en: 'Unsafe', km: 'គ្រោះថ្នាក់' },
  { id: 'unclear', emoji: '❓', en: 'Not clear', km: 'មិនច្បាស់' },
]

export const SOURCES: WaterLabel[] = [
  { id: 'tubewell', emoji: '🕳️', en: 'Tube well', km: 'អណ្ដូងបំពង់' },
  { id: 'dugwell', emoji: '🪣', en: 'Dug well', km: 'អណ្ដូងជីក' },
  { id: 'pond', emoji: '🏞️', en: 'Pond / river', km: 'ស្រះ / ទន្លេ' },
  { id: 'rain', emoji: '🌧️', en: 'Rain water', km: 'ទឹកភ្លៀង' },
  { id: 'piped', emoji: '🚰', en: 'Piped', km: 'ទឹកម៉ាស៊ីន' },
  { id: 'bottled', emoji: '🍶', en: 'Bottled', km: 'ដបទឹក' },
  { id: 'other', emoji: '💦', en: 'Other', km: 'ផ្សេង' },
]

export const TEST_BY_ID = Object.fromEntries(TESTS.map((c) => [c.id, c]))
export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((c) => [c.id, c]))
export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((c) => [c.id, c]))
