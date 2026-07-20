/**
 * Client for the "Report a community issue" flow (/report): anonymous device id,
 * consenting identity, and upload to the Worker (`POST /api/report/sample`).
 * Privacy: the issue photo + type (+ optional location) only — never people.
 */

import type { GeoPoint } from './geo'

const DEVICE_KEY = 'iany.report.device'
const PROFILE_KEY = 'iany.report.profile'

export interface ReportProfile {
  consent: boolean
  creditName: string
  region: string
}

export const EMPTY_REPORT_PROFILE: ReportProfile = { consent: false, creditName: '', region: '' }

/** Stable per-device anonymous id (e.g. `i-3f9a2c71`). */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    const rnd =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : Math.random().toString(16).slice(2, 10)
    id = `i-${rnd}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function loadReportProfile(): ReportProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { ...EMPTY_REPORT_PROFILE, ...(JSON.parse(raw) as Partial<ReportProfile>) }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_REPORT_PROFILE }
}

export function saveReportProfile(p: ReportProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export interface ReportUpload {
  image: Blob
  type: string // issue-type id (see reportLabels.ts)
  gps?: GeoPoint | null
  note?: string
  width?: number
  height?: number
}

/** POST one (image, type) report to the Worker. Returns the server id. */
export async function uploadSample(sample: ReportUpload, profile: ReportProfile): Promise<string> {
  const form = new FormData()
  const ext = sample.image.type === 'image/png' ? 'png' : 'jpg'
  form.set('image', sample.image, `report.${ext}`)
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

  const res = await fetch('/api/report/sample', { method: 'POST', body: form })
  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `upload failed (${res.status})`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

export interface ReportStats {
  samples: number
  devices: number
}

export async function fetchReportStats(): Promise<ReportStats | null> {
  try {
    const res = await fetch('/api/report/stats')
    if (!res.ok) return null
    return (await res.json()) as ReportStats
  } catch {
    return null
  }
}
