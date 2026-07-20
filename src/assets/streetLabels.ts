/**
 * Labels for the /street collector — Cambodia-specific vehicle types.
 *
 * The generic /traffic counter uses a COCO object detector, which has no class
 * for a tuk-tuk or remork — it miscounts them as "car" or "motorbike". This
 * collector gathers labelled single-vehicle photos so we can train a
 * Cambodia-aware classifier and, later, a "detect-then-classify" pipeline that
 * counts tuk-tuks, remork, and cyclos correctly. See docs/SMARTCITY-AI.md.
 *
 * `type` is the classifier target. One vehicle per photo, filling the frame.
 */

export interface StreetLabel {
  id: string
  emoji: string
  en: string
  km: string
  /** A short disambiguation shown under the chip when picked. */
  hintEn?: string
  hintKm?: string
}

export const STREET_TYPES: StreetLabel[] = [
  { id: 'tuktuk', emoji: '🛺', en: 'Tuk-tuk (auto)', km: 'តុកតុក (បីកង់)',
    hintEn: 'three-wheel auto-rickshaw (Indian-style)', hintKm: 'រ៉ឺម៉កបីកង់ម៉ាស៊ីន' },
  { id: 'remork', emoji: '🛺', en: 'Remork', km: 'រ៉ឺម៉ក',
    hintEn: 'motorbike pulling a passenger trailer (classic Khmer tuk-tuk)', hintKm: 'ម៉ូតូអូសរទេះអ្នកដំណើរ' },
  { id: 'moto_trailer', emoji: '🏍️', en: 'Moto + cargo trailer', km: 'ម៉ូតូ + រទេះទំនិញ',
    hintEn: 'motorbike hauling a goods trailer / cart', hintKm: 'ម៉ូតូអូសរទេះទំនិញ' },
  { id: 'motorbike', emoji: '🏍️', en: 'Motorbike', km: 'ម៉ូតូ',
    hintEn: 'ordinary motorcycle / scooter', hintKm: 'ម៉ូតូធម្មតា' },
  { id: 'cyclo', emoji: '🚲', en: 'Cyclo', km: 'ស៊ីក្លូ',
    hintEn: 'pedal trishaw (rider behind a front seat)', hintKm: 'រទេះជិះបីកង់ជាន់' },
  { id: 'bicycle', emoji: '🚲', en: 'Bicycle', km: 'កង់',
    hintEn: 'ordinary pedal bicycle', hintKm: 'កង់ជាន់ធម្មតា' },
  { id: 'car', emoji: '🚗', en: 'Car', km: 'ឡាន',
    hintEn: 'sedan / hatchback / SUV', hintKm: 'ឡានធម្មតា / SUV' },
  { id: 'pickup', emoji: '🛻', en: 'Pickup', km: 'ឡានស្ទូច',
    hintEn: 'pickup truck (open bed)', hintKm: 'ឡានពីកអាប់' },
  { id: 'van', emoji: '🚐', en: 'Van / minibus', km: 'រថភ្លើង / ឡានក្រុងតូច',
    hintEn: 'van or minibus', hintKm: 'ឡានវ៉ាន់ ឬឡានក្រុងតូច' },
  { id: 'bus', emoji: '🚌', en: 'Bus', km: 'ឡានក្រុង',
    hintEn: 'full-size bus', hintKm: 'ឡានក្រុងធំ' },
  { id: 'truck', emoji: '🚚', en: 'Truck', km: 'ឡានដឹកទំនិញ',
    hintEn: 'lorry / heavy goods truck', hintKm: 'ឡានដឹកទំនិញធ្ងន់' },
  { id: 'other', emoji: '❓', en: 'Other', km: 'ផ្សេងៗ',
    hintEn: 'anything else on the road', hintKm: 'យានយន្តផ្សេងទៀត' },
]

export const STREET_BY_ID = Object.fromEntries(STREET_TYPES.map((c) => [c.id, c]))
