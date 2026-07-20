/**
 * Client for the "Contribute street-vehicle photos" flow (/street): a stable
 * anonymous device id, the consenting contributor's identity, and the upload to
 * the Worker (`POST /api/street/sample` → R2 + D1).
 *
 * Feeds a Cambodia-aware vehicle classifier (tuk-tuk / remork / cyclo — the
 * classes COCO detectors lack). Privacy: only the vehicle photo + label are
 * sent. The device id is a random token; a real name is opt-in, for credits.
 */

const DEVICE_KEY = 'iany.street.device'
const PROFILE_KEY = 'iany.street.profile'

export interface StreetProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_STREET_PROFILE: StreetProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `t-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `t-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadStreetProfile(): StreetProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_STREET_PROFILE, ...(JSON.parse(raw) as Partial<StreetProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_STREET_PROFILE }
}

export function saveStreetProfile(p: StreetProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

import type { GeoPoint } from './geo'

export interface StreetUpload {
  image: Blob
  type: string // vehicle-type id (see streetLabels.ts)
  gps?: GeoPoint | null // optional — where the photo was taken
  note?: string
  width?: number
  height?: number
}

/** POST one (image, type) sample to the Worker. Returns the server id. */
export async function uploadSample(sample: StreetUpload, profile: StreetProfile): Promise<string> {
  const form = new FormData()
  const ext = sample.image.type === 'image/png' ? 'png' : 'jpg'
  form.set('image', sample.image, `street.${ext}`)
  form.set('type', sample.type)
  form.set('device', deviceId())
  form.set('consent', profile.consent ? '1' : '0')
  if (sample.gps) {
    form.set('lat', String(sample.gps.lat))
    form.set('lng', String(sample.gps.lng))
    form.set('acc', String(sample.gps.acc))
  }
  if (sample.note?.trim()) form.set('note', sample.note.trim())
  if (sample.width) form.set('width', String(sample.width))
  if (sample.height) form.set('height', String(sample.height))
  if (profile.creditName.trim()) form.set('creditName', profile.creditName.trim())
  if (profile.region.trim()) form.set('region', profile.region.trim())

  const res = await fetch('/api/street/sample', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface StreetStats {
  samples: number
  devices: number
  types: number
}

export async function fetchStreetStats(): Promise<StreetStats | null> {
  try {
    const res = await fetch('/api/street/stats')
    if (!res.ok) return null
    return (await res.json()) as StreetStats
  } catch {
    return null
  }
}
