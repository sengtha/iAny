/**
 * Client for the "Contribute Khmer text photos" flow (/scan): a stable
 * anonymous device id, the consenting contributor's identity, and the upload to
 * the Worker (`POST /api/ocr/sample` → R2 + D1).
 *
 * Privacy: the device id is a random token, never a name. A real name is sent
 * ONLY as an opt-in `creditName` for the released open-source dataset credits.
 */

const DEVICE_KEY = 'iany.ocr.device'
const PROFILE_KEY = 'iany.ocr.profile'

export interface OcrProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_OCR_PROFILE: OcrProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `d-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `d-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadOcrProfile(): OcrProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_OCR_PROFILE, ...(JSON.parse(raw) as Partial<OcrProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_OCR_PROFILE }
}

export function saveOcrProfile(p: OcrProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface OcrUpload {
  image: Blob
  text: string
  ocrGuess?: string
  width?: number
  height?: number
}

/** POST one (image, transcript) sample to the Worker. Returns the server id. */
export async function uploadSample(clip: OcrUpload, profile: OcrProfile): Promise<string> {
  const form = new FormData()
  const ext = clip.image.type === 'image/png' ? 'png' : 'jpg'
  form.set('image', clip.image, `scan.${ext}`)
  form.set('text', clip.text)
  form.set('device', deviceId())
  form.set('consent', profile.consent ? '1' : '0')
  if (clip.ocrGuess) form.set('ocrGuess', clip.ocrGuess)
  if (clip.width) form.set('width', String(clip.width))
  if (clip.height) form.set('height', String(clip.height))
  if (profile.creditName.trim()) form.set('creditName', profile.creditName.trim())
  if (profile.region.trim()) form.set('region', profile.region.trim())

  const res = await fetch('/api/ocr/sample', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface OcrStats {
  samples: number
  devices: number
}

export async function fetchOcrStats(): Promise<OcrStats | null> {
  try {
    const res = await fetch('/api/ocr/stats')
    if (!res.ok) return null
    return (await res.json()) as OcrStats
  } catch {
    return null
  }
}
