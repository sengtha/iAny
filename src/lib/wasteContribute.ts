/**
 * Client for the "Contribute waste photos" flow (/waste): a stable anonymous
 * device id, the consenting contributor's identity, and the upload to the Worker
 * (`POST /api/waste/sample` → R2 + D1).
 *
 * Privacy: only the item photo + label are sent. The device id is a random token;
 * a real name is opt-in, only for dataset credits.
 */

const DEVICE_KEY = 'iany.waste.device'
const PROFILE_KEY = 'iany.waste.profile'

export interface WasteProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_WASTE_PROFILE: WasteProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `r-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `r-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadWasteProfile(): WasteProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_WASTE_PROFILE, ...(JSON.parse(raw) as Partial<WasteProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_WASTE_PROFILE }
}

export function saveWasteProfile(p: WasteProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface WasteUpload {
  image: Blob
  type: string // waste-type id (see wasteLabels.ts)
  note?: string
  width?: number
  height?: number
}

/** POST one (image, type) sample to the Worker. Returns the server id. */
export async function uploadSample(sample: WasteUpload, profile: WasteProfile): Promise<string> {
  const form = new FormData()
  const ext = sample.image.type === 'image/png' ? 'png' : 'jpg'
  form.set('image', sample.image, `waste.${ext}`)
  form.set('type', sample.type)
  form.set('device', deviceId())
  form.set('consent', profile.consent ? '1' : '0')
  if (sample.note?.trim()) form.set('note', sample.note.trim())
  if (sample.width) form.set('width', String(sample.width))
  if (sample.height) form.set('height', String(sample.height))
  if (profile.creditName.trim()) form.set('creditName', profile.creditName.trim())
  if (profile.region.trim()) form.set('region', profile.region.trim())

  const res = await fetch('/api/waste/sample', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface WasteStats {
  samples: number
  devices: number
  types: number
}

export async function fetchWasteStats(): Promise<WasteStats | null> {
  try {
    const res = await fetch('/api/waste/stats')
    if (!res.ok) return null
    return (await res.json()) as WasteStats
  } catch {
    return null
  }
}
