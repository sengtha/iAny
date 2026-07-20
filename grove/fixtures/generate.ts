/**
 * Regenerate the Grove fixtures — REAL device-signed sample data a consumer
 * (e.g. a CamboVerse agent) can develop + test against before a live node exists.
 * Every observation/attestation here verifies with grove/core/grove.ts.
 *
 *   npx tsx grove/fixtures/generate.ts
 *
 * Signatures/keys differ each run (ECDSA is randomized) but always verify. The
 * committed files are one such valid run. Timestamps are fixed for stable diffs.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  generateDeviceKey, buildObservation, signObservation, signAttestation,
  verifyObservation, verifyAttestation, trustScore,
  type GardenObservation,
} from '../core/grove'

const here = dirname(fileURLToPath(import.meta.url))
const write = (name: string, data: unknown) =>
  writeFileSync(join(here, name), JSON.stringify(data, null, 2) + '\n')

// Server first-seen times are the node's, not the device's — fixed for stable diffs.
const SEEN = '2026-07-20T09:00:00.000Z'
const fuzz = (v: number) => Math.round(v * 100) / 100

// A gardener device (author) and a neighbour device (attester).
const gardener = await generateDeviceKey()
const neighbour = await generateDeviceKey()

// A mango tree in "home-garden-01" observed twice over a year (a growth chain).
const y1 = await signObservation(buildObservation({
  device: gardener.device, plot: 'home-garden-01', species: 'mango', count: 1,
  measure: { method: 'dbh_height', dbh_cm: 16, height_m: 6 },
  observedAt: '2025-07-15T08:30:00.000Z', photoHash: 'b1'.repeat(32),
  gps: { lat: 11.556789, lng: 104.928123, acc: 8 },
}), gardener.keyPair)

const y2 = await signObservation(buildObservation({
  device: gardener.device, plot: 'home-garden-01', species: 'mango', count: 1,
  measure: { method: 'dbh_height', dbh_cm: 20, height_m: 8 },
  observedAt: '2026-07-14T08:30:00.000Z', photoHash: 'b2'.repeat(32),
  gps: { lat: 11.556789, lng: 104.928123, acc: 8 }, prev: y1.id,
}), gardener.keyPair)

// Two coconut palms in a second plot.
const coco = await signObservation(buildObservation({
  device: gardener.device, plot: 'village-plot-07', species: 'coconut', count: 2,
  measure: { method: 'dbh_height', dbh_cm: 25, height_m: 12 },
  observedAt: '2026-07-18T07:10:00.000Z', photoHash: 'c3'.repeat(32),
  gps: { lat: 11.61200, lng: 104.90050, acc: 12 },
}), gardener.keyPair)

// The neighbour co-signs (confirms) the latest mango observation.
const att = await signAttestation({
  ref: y2.id, device: neighbour.device, verdict: 'confirm',
  note: 'Visited — a healthy mango, ~8 m.', at: '2026-07-16T10:00:00.000Z',
}, neighbour.keyPair)

// Verify everything before writing — a fixture that doesn't verify is worthless.
for (const o of [y1, y2, coco]) {
  const v = await verifyObservation(o)
  if (!v.ok) throw new Error('observation failed to verify: ' + o.id)
}
if (!(await verifyAttestation(att)).ok) throw new Error('attestation failed to verify')

const all = [y1, y2, coco]

// (A) Offline export bundle — exactly what /garden → Export JSON produces.
write('grove-bundle.json', { v: 1, kind: 'grove-bundle', observations: all })

// (B) Node response shapes (match grove/worker/handlers.ts exactly):

// GET /api/grove/stats
write('stats.json', {
  observations: all.length,
  devices: new Set(all.map((o) => o.device)).size,
  plots: new Set(all.map((o) => o.plot)).size,
  plants: all.reduce((s, o) => s + o.count, 0),
  co2Kg: Math.round(all.reduce((s, o) => s + o.co2Kg, 0) * 100) / 100,
})

// GET /api/grove/feed — newest first, GPS coarsened to ~2dp, no raw bytes.
const feedItem = (o: GardenObservation) => ({
  id: o.id, device: o.device, plot: o.plot, species: o.species, count: o.count,
  co2Kg: o.co2Kg, lat: o.gps ? fuzz(o.gps.lat) : null, lng: o.gps ? fuzz(o.gps.lng) : null,
  observedAt: o.observedAt, prev: o.prev, createdAt: SEEN,
})
write('feed.json', { items: [coco, y2, y1].map(feedItem), cursor: SEEN })

// GET /api/grove/observation/:id — single record WITH raw signed bytes + trust.
write('observation.json', {
  observation: y2, attestations: [att], trust: trustScore(y2, [att]),
})

// GET /api/grove/plot/home-garden-01 — the growth chain, oldest→newest, scored.
write('plot.json', {
  plot: 'home-garden-01',
  totalCo2: Math.round((y1.co2Kg + y2.co2Kg) * 100) / 100,
  records: [
    { observation: y1, attestations: [], trust: trustScore(y1, []) },
    { observation: y2, attestations: [att], trust: trustScore(y2, [att]) },
  ],
})

console.log('fixtures written. sample ids:')
console.log('  y1 (mango 2025):', y1.id.slice(0, 16), y1.co2Kg, 'kg CO2')
console.log('  y2 (mango 2026):', y2.id.slice(0, 16), y2.co2Kg, 'kg CO2', '| trust', trustScore(y2, [att]))
console.log('  coco (2 palms):', coco.id.slice(0, 16), coco.co2Kg, 'kg CO2')
