/**
 * Client for the "Contribute Khmer Sign Language" flow (/sign): a stable
 * anonymous device id, the consenting contributor's identity, and the upload to
 * the Worker (`POST /api/sign/sample` → R2 + D1).
 *
 * Privacy by design: we upload **hand landmarks only, never the video**. Each
 * sample is a short sequence of 21-keypoint hand skeletons (see handTracker.ts)
 * — tiny, and it carries no face or background, so a contributor can't be
 * identified from it. The device id is a random token, never a name; a real
 * name is sent ONLY as an opt-in `creditName` for the open-source dataset.
 */

import type { HandFrame } from './handTracker'

const DEVICE_KEY = 'iany.sign.device'
const PROFILE_KEY = 'iany.sign.profile'

export interface SignProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_SIGN_PROFILE: SignProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `g-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `g-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadSignProfile(): SignProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_SIGN_PROFILE, ...(JSON.parse(raw) as Partial<SignProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_SIGN_PROFILE }
}

export function saveSignProfile(p: SignProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

/** One recorded gesture: the label being signed + the landmark sequence. */
export interface SignSample {
  /** Prompt id, e.g. `letter-01` — links the recording to its label. */
  promptId: string
  /** The Khmer label being signed (letter or word). */
  label: string
  /** Capture rate; frames are evenly spaced in time. */
  fps: number
  /** The landmark sequence — one HandFrame per captured frame. */
  frames: HandFrame[]
}

/** POST one gesture sample (landmarks only) to the Worker. Returns server id. */
export async function uploadSample(sample: SignSample, profile: SignProfile): Promise<string> {
  const body = {
    device: deviceId(),
    consent: profile.consent,
    promptId: sample.promptId,
    label: sample.label,
    fps: sample.fps,
    frames: sample.frames,
    creditName: profile.creditName.trim() || undefined,
    region: profile.region.trim() || undefined,
  }
  const res = await fetch('/api/sign/sample', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

/** Accepted upload types → the extension the Worker recognises. */
export const SIGN_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/3gpp']
export const SIGN_VIDEO_MAX_BYTES = 64 * 1024 * 1024 // keep in sync with the Worker

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
}

// Some phones hand us a File with an empty `type`; fall back to the extension so
// a valid clip isn't rejected and the Worker gets a content-type it recognises.
function guessMime(file: File): string {
  if (SIGN_VIDEO_TYPES.includes(file.type)) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? file.type ?? ''
}

/** Whether this file is an accepted sign-video (by MIME or, if absent, extension). */
export function isSupportedSignVideo(file: File): boolean {
  return SIGN_VIDEO_TYPES.includes(guessMime(file))
}

/**
 * Upload a whole Khmer Sign Language video the contributor OWNS or has permission
 * to share, paired with the Khmer text of what is signed. The file is sent as the
 * raw request body (streamed to R2 server-side); metadata rides in the query so we
 * never buffer the video. Unlike uploadSample() this stores the real video, so it
 * carries its own explicit rights consent.
 */
export async function uploadSignVideo(
  file: File,
  label: string,
  meta: { consent: boolean; creditName?: string; region?: string },
): Promise<string> {
  const q = new URLSearchParams({
    device: deviceId(),
    label: label.trim(),
    consent: meta.consent ? '1' : '0',
  })
  if (meta.creditName?.trim()) q.set('creditName', meta.creditName.trim())
  if (meta.region?.trim()) q.set('region', meta.region.trim())
  const res = await fetch(`/api/sign/video?${q.toString()}`, {
    method: 'POST',
    headers: { 'content-type': guessMime(file) || 'video/mp4' },
    body: file,
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface SignStats {
  samples: number
  devices: number
  labels: number
  /** Uploaded videos (the "Upload a video" mode); may be absent on old nodes. */
  videos?: number
}

export async function fetchSignStats(): Promise<SignStats | null> {
  try {
    const res = await fetch('/api/sign/stats')
    if (!res.ok) return null
    return (await res.json()) as SignStats
  } catch {
    return null
  }
}
