/**
 * Client for the "Contribute your voice" flow: a stable anonymous speaker id,
 * the consenting contributor's identity (kept locally + sent with each clip),
 * and the upload to the Worker (`POST /voice/clip` → R2 + D1).
 *
 * Privacy: the speaker id is a random token, never a name. A real name is sent
 * ONLY as an opt-in `creditName` when the contributor asked to be credited in
 * the open-source dataset — see docs/VOICE-COLLECTION.md.
 */

const SPEAKER_KEY = 'iany.voice.speaker'
const PROFILE_KEY = 'iany.voice.profile'

export interface VoiceProfile {
  /** Consent recorded on-device (required before any upload). */
  consent: boolean
  /** Opt-in public credit name for the released dataset (may be empty). */
  creditName: string
  /** Optional, self-reported, coarse — never required. */
  classLabel: string
  gender: '' | 'female' | 'male' | 'other'
  ageBand: '' | 'under12' | '12to15' | '16to18' | 'adult'
  region: string
}

export const EMPTY_PROFILE: VoiceProfile = {
  consent: false,
  creditName: '',
  classLabel: '',
  gender: '',
  ageBand: '',
  region: '',
}

/** Stable per-device anonymous speaker id (e.g. `s-3f9a2c71`). */
export function speakerId(): string {
  let id = localStorage.getItem(SPEAKER_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `s-${rnd}`
    localStorage.setItem(SPEAKER_KEY, id)
  }
  return id
}

export function loadProfile(): VoiceProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<VoiceProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_PROFILE }
}

export function saveProfile(p: VoiceProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface UploadClip {
  wav: Blob
  sentence: string
  sentenceId: string
  durationSec: number
}

/** POST one clip to the Worker. Returns the server clip id. */
export async function uploadClip(clip: UploadClip, profile: VoiceProfile): Promise<string> {
  const form = new FormData()
  form.set('audio', clip.wav, 'clip.wav')
  form.set('sentence', clip.sentence)
  form.set('sentenceId', clip.sentenceId)
  form.set('speaker', speakerId())
  form.set('lang', 'km')
  form.set('durationMs', String(Math.round(clip.durationSec * 1000)))
  form.set('consent', profile.consent ? '1' : '0')
  if (profile.creditName.trim()) form.set('creditName', profile.creditName.trim())
  if (profile.classLabel.trim()) form.set('classLabel', profile.classLabel.trim())
  if (profile.gender) form.set('gender', profile.gender)
  if (profile.ageBand) form.set('ageBand', profile.ageBand)
  if (profile.region.trim()) form.set('region', profile.region.trim())

  const res = await fetch('/voice/clip', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface VoiceStats {
  clips: number
  speakers: number
  hours: number
}

/** Aggregate, non-identifying counts to motivate a class ("1,234 clips!"). */
export async function fetchStats(): Promise<VoiceStats | null> {
  try {
    const res = await fetch('/voice/stats')
    if (!res.ok) return null
    return (await res.json()) as VoiceStats
  } catch {
    return null
  }
}

/** How many prompts this device already recorded (local progress only). */
const DONE_KEY = 'iany.voice.done'
export function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* ignore */
  }
  return new Set()
}
export function markDone(ids: Set<string>): void {
  localStorage.setItem(DONE_KEY, JSON.stringify([...ids]))
}
