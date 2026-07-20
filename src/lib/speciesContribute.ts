/**
 * Client for the "Contribute nature photos" flow (/species): anonymous device id,
 * consenting identity, and upload to the Worker (`POST /api/species/sample`).
 * Privacy: only the photo + labels (+ optional location). Name opt-in for credits.
 */

import type { GeoPoint } from './geo'

const DEVICE_KEY = 'iany.species.device'
const PROFILE_KEY = 'iany.species.profile'

export interface SpeciesProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_SPECIES_PROFILE: SpeciesProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `n-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `n-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadSpeciesProfile(): SpeciesProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_SPECIES_PROFILE, ...(JSON.parse(raw) as Partial<SpeciesProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_SPECIES_PROFILE }
}

export function saveSpeciesProfile(p: SpeciesProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface SpeciesUpload {
  image: Blob
  group: string // group id (see speciesLabels.ts)
  species?: string // free-text species name (optional)
  gps?: GeoPoint | null
  width?: number
  height?: number
}

/** POST one (image, group) sample to the Worker. Returns the server id. */
export async function uploadSample(sample: SpeciesUpload, profile: SpeciesProfile): Promise<string> {
  const form = new FormData()
  const ext = sample.image.type === 'image/png' ? 'png' : 'jpg'
  form.set('image', sample.image, `species.${ext}`)
  form.set('group', sample.group)
  form.set('device', deviceId())
  form.set('consent', profile.consent ? '1' : '0')
  if (sample.species?.trim()) form.set('species', sample.species.trim())
  if (sample.gps) {
    form.set('lat', String(sample.gps.lat))
    form.set('lng', String(sample.gps.lng))
    form.set('acc', String(sample.gps.acc))
  }
  if (sample.width) form.set('width', String(sample.width))
  if (sample.height) form.set('height', String(sample.height))
  if (profile.creditName.trim()) form.set('creditName', profile.creditName.trim())
  if (profile.region.trim()) form.set('region', profile.region.trim())

  const res = await fetch('/api/species/sample', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface SpeciesStats {
  samples: number
  devices: number
}

export async function fetchSpeciesStats(): Promise<SpeciesStats | null> {
  try {
    const res = await fetch('/api/species/stats')
    if (!res.ok) return null
    return (await res.json()) as SpeciesStats
  } catch {
    return null
  }
}
