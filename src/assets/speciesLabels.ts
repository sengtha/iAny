/**
 * Groups for the /species collector — biodiversity + disease-vector (mosquito)
 * photos. A model trained from this classifies the broad GROUP on-device; the
 * free-text species name (metadata) enriches finer future models. Nature has too
 * many species for a fixed list, so group + optional name is the right data model
 * (iNaturalist works similarly). Location is optional (a sighting map point).
 * See docs/ENVIRONMENT-AI.md.
 */

export interface SpeciesGroup {
  id: string
  emoji: string
  en: string
  km: string
}

export const GROUPS: SpeciesGroup[] = [
  { id: 'plant', emoji: '🌿', en: 'Plant', km: 'រុក្ខជាតិ' },
  { id: 'bird', emoji: '🐦', en: 'Bird', km: 'បក្សី' },
  { id: 'insect', emoji: '🐛', en: 'Insect', km: 'សត្វល្អិត' },
  { id: 'mosquito', emoji: '🦟', en: 'Mosquito', km: 'មូស' },
  { id: 'fish', emoji: '🐟', en: 'Fish', km: 'ត្រី' },
  { id: 'reptile', emoji: '🦎', en: 'Reptile / amphibian', km: 'សត្វលូន / កង្កែប' },
  { id: 'mammal', emoji: '🐾', en: 'Mammal', km: 'ថនិកសត្វ' },
  { id: 'fungus', emoji: '🍄', en: 'Fungus', km: 'ផ្សិត' },
  { id: 'other', emoji: '❓', en: 'Other', km: 'ផ្សេង' },
]

export const GROUP_BY_ID = Object.fromEntries(GROUPS.map((c) => [c.id, c]))
