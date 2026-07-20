/**
 * Client for the "Contribute rapid-test photos" flow (/health-test): a stable
 * anonymous device id, the consenting contributor's identity, and the upload to
 * the Worker (`POST /api/health-test/sample` → R2 + D1).
 *
 * Privacy (see docs/HEALTH-AI.md): only the test-strip photo + labels are sent —
 * never faces, names, or documents. The device id is a random token; a real name
 * is opt-in, only for dataset credits.
 */

const DEVICE_KEY = 'iany.htest.device'
const PROFILE_KEY = 'iany.htest.profile'

export interface HealthProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_HEALTH_PROFILE: HealthProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `h-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `h-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadHealthProfile(): HealthProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_HEALTH_PROFILE, ...(JSON.parse(raw) as Partial<HealthProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_HEALTH_PROFILE }
}

export function saveHealthProfile(p: HealthProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface HealthUpload {
  image: Blob
  test: string // test-type id (see healthTestLabels.ts)
  result: string // result id: positive / negative / invalid
  note?: string
  width?: number
  height?: number
}

/** POST one (image, test, result) sample to the Worker. Returns the server id. */
export async function uploadSample(sample: HealthUpload, profile: HealthProfile): Promise<string> {
  const form = new FormData()
  const ext = sample.image.type === 'image/png' ? 'png' : 'jpg'
  form.set('image', sample.image, `test.${ext}`)
  form.set('test', sample.test)
  form.set('result', sample.result)
  form.set('device', deviceId())
  form.set('consent', profile.consent ? '1' : '0')
  if (sample.note?.trim()) form.set('note', sample.note.trim())
  if (sample.width) form.set('width', String(sample.width))
  if (sample.height) form.set('height', String(sample.height))
  if (profile.creditName.trim()) form.set('creditName', profile.creditName.trim())
  if (profile.region.trim()) form.set('region', profile.region.trim())

  const res = await fetch('/api/health-test/sample', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface HealthStats {
  samples: number
  devices: number
}

export async function fetchHealthStats(): Promise<HealthStats | null> {
  try {
    const res = await fetch('/api/health-test/stats')
    if (!res.ok) return null
    return (await res.json()) as HealthStats
  } catch {
    return null
  }
}
