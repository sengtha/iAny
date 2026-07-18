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

export interface SignStats {
  samples: number
  devices: number
  labels: number
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
