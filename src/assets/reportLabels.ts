/**
 * Issue types for the /report collector — citizen infrastructure / environment
 * reports. A model trained from this sorts a report photo by type; the GPS makes
 * it actionable/mappable. Privacy: photograph the ISSUE, not people. See
 * docs/ENVIRONMENT-AI.md.
 */

export interface ReportType {
  id: string
  emoji: string
  en: string
  km: string
}

export const ISSUE_TYPES: ReportType[] = [
  { id: 'rubbish', emoji: '🗑️', en: 'Rubbish / dumping', km: 'សំរាម / ចាក់ចោល' },
  { id: 'flooding', emoji: '🌊', en: 'Flooding', km: 'ទឹកជំនន់' },
  { id: 'drainage', emoji: '🕳️', en: 'Blocked drain', km: 'លូស្ទះ' },
  { id: 'water_leak', emoji: '🚰', en: 'Water leak', km: 'ទឹកលេច' },
  { id: 'pothole', emoji: '🛣️', en: 'Road damage', km: 'ផ្លូវខូច' },
  { id: 'streetlight', emoji: '💡', en: 'Broken light', km: 'ភ្លើងខូច' },
  { id: 'fallen_tree', emoji: '🌳', en: 'Fallen tree', km: 'ដើមឈើដួល' },
  { id: 'other', emoji: '⚠️', en: 'Other', km: 'ផ្សេង' },
]

export const ISSUE_BY_ID = Object.fromEntries(ISSUE_TYPES.map((c) => [c.id, c]))
