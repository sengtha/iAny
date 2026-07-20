/**
 * Client for the "Contribute water-test photos" flow (/water): a stable anonymous
 * device id, the consenting contributor's identity, and the upload to the Worker
 * (`POST /api/water/sample` → R2 + D1).
 *
 * Privacy (see docs/ENVIRONMENT-AI.md): only the strip photo + labels are sent.
 * The device id is a random token; a real name is opt-in, only for dataset credits.
 */

const DEVICE_KEY = 'iany.water.device'
const PROFILE_KEY = 'iany.water.profile'

export interface WaterProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_WATER_PROFILE: WaterProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `w-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `w-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadWaterProfile(): WaterProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_WATER_PROFILE, ...(JSON.parse(raw) as Partial<WaterProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_WATER_PROFILE }
}

export function saveWaterProfile(p: WaterProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface WaterUpload {
  image: Blob
  test: string // test-type id (see waterLabels.ts)
  level: string // safety band: safe / caution / unsafe / unclear
  source?: string // water-source id
  note?: string
  width?: number
  height?: number
}

/** POST one (image, test, level) sample to the Worker. Returns the server id. */
export async function uploadSample(sample: WaterUpload, profile: WaterProfile): Promise<string> {
  const form = new FormData()
  const ext = sample.image.type === 'image/png' ? 'png' : 'jpg'
  form.set('image', sample.image, `water.${ext}`)
  form.set('test', sample.test)
  form.set('level', sample.level)
  form.set('device', deviceId())
  form.set('consent', profile.consent ? '1' : '0')
  if (sample.source) form.set('source', sample.source)
  if (sample.note?.trim()) form.set('note', sample.note.trim())
  if (sample.width) form.set('width', String(sample.width))
  if (sample.height) form.set('height', String(sample.height))
  if (profile.creditName.trim()) form.set('creditName', profile.creditName.trim())
  if (profile.region.trim()) form.set('region', profile.region.trim())

  const res = await fetch('/api/water/sample', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface WaterStats {
  samples: number
  devices: number
}

export async function fetchWaterStats(): Promise<WaterStats | null> {
  try {
    const res = await fetch('/api/water/stats')
    if (!res.ok) return null
    return (await res.json()) as WaterStats
  } catch {
    return null
  }
}
