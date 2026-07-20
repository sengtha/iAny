/**
 * Client for the "Contribute crop photos" flow (/crop): a stable anonymous device
 * id, the consenting contributor's identity, and the upload to the Worker
 * (`POST /api/crop/sample` → R2 + D1).
 *
 * Privacy: the device id is a random token, never a name. A real name is sent ONLY
 * as an opt-in `creditName` for the released open-source dataset credits.
 */

const DEVICE_KEY = 'iany.crop.device'
const PROFILE_KEY = 'iany.crop.profile'

export interface CropProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_CROP_PROFILE: CropProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `c-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `c-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadCropProfile(): CropProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_CROP_PROFILE, ...(JSON.parse(raw) as Partial<CropProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_CROP_PROFILE }
}

export function saveCropProfile(p: CropProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface CropUpload {
  image: Blob
  crop: string // crop id (see cropLabels.ts)
  condition: string // condition id
  note?: string
  width?: number
  height?: number
}

/** POST one (image, crop, condition) sample to the Worker. Returns the server id. */
export async function uploadSample(sample: CropUpload, profile: CropProfile): Promise<string> {
  const form = new FormData()
  const ext = sample.image.type === 'image/png' ? 'png' : 'jpg'
  form.set('image', sample.image, `crop.${ext}`)
  form.set('crop', sample.crop)
  form.set('condition', sample.condition)
  form.set('device', deviceId())
  form.set('consent', profile.consent ? '1' : '0')
  if (sample.note?.trim()) form.set('note', sample.note.trim())
  if (sample.width) form.set('width', String(sample.width))
  if (sample.height) form.set('height', String(sample.height))
  if (profile.creditName.trim()) form.set('creditName', profile.creditName.trim())
  if (profile.region.trim()) form.set('region', profile.region.trim())

  const res = await fetch('/api/crop/sample', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface CropStats {
  samples: number
  devices: number
  crops: number
}

export async function fetchCropStats(): Promise<CropStats | null> {
  try {
    const res = await fetch('/api/crop/stats')
    if (!res.ok) return null
    return (await res.json()) as CropStats
  } catch {
    return null
  }
}
