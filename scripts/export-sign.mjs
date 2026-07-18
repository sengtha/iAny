#!/usr/bin/env node
/**
 * Export the crowd-sourced Khmer Sign Language samples into a training-ready set.
 *
 * Pulls every sample from the Worker admin API (metadata from D1, landmark
 * sequences from R2), writing:
 *   out/sequences/<id>.json      the per-frame hand-landmark sequences
 *   out/labels.jsonl             {seq, label, prompt_id, frames, hand_frames, region} per line
 *   out/labels.csv               seq,label  (simple two-column form)
 *   out/CREDITS.md               opt-in contributor names (for the release)
 *
 * We only ever stored hand landmarks — there is no video or image to export, so
 * the dataset is inherently privacy-preserving.
 *
 * Usage:
 *   SIGN_ADMIN_TOKEN=xxxx node scripts/export-sign.mjs \
 *     [--base https://iany.app] [--out ./sign-out]
 *
 * The token is the same RADIO_ADMIN_TOKEN secret the Worker uses. Never commit it.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const BASE = opt('--base', process.env.SIGN_BASE || 'https://iany.app').replace(/\/$/, '')
const OUT = opt('--out', './sign-out')
const TOKEN = process.env.SIGN_ADMIN_TOKEN
if (!TOKEN) {
  console.error('Set SIGN_ADMIN_TOKEN (the Worker RADIO_ADMIN_TOKEN secret).')
  process.exit(1)
}
const auth = { authorization: `Bearer ${TOKEN}` }

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  await mkdir(path.join(OUT, 'sequences'), { recursive: true })
  const csv = [['seq', 'label']]
  const jsonl = []
  const credits = new Map()
  const labels = new Map()
  let after = ''
  let total = 0

  for (;;) {
    const url = `${BASE}/api/sign/admin/samples?limit=300${after ? `&after=${encodeURIComponent(after)}` : ''}`
    const res = await fetch(url, { headers: auth })
    if (!res.ok) throw new Error(`list failed ${res.status}: ${await res.text()}`)
    const { samples, next } = await res.json()
    if (!samples.length) break

    for (const s of samples) {
      const rel = path.join('sequences', `${s.id}.json`)
      const seq = await fetch(`${BASE}/api/sign/admin/sequence/${s.id}`, { headers: auth })
      if (!seq.ok) {
        console.warn(`  skip ${s.id}: sequence ${seq.status}`)
        continue
      }
      await pipeline(Readable.fromWeb(seq.body), createWriteStream(path.join(OUT, rel)))
      csv.push([rel, s.label])
      jsonl.push(JSON.stringify({
        seq: rel, label: s.label, prompt_id: s.promptId ?? null,
        frames: s.frames ?? null, hand_frames: s.handFrames ?? null, region: s.region ?? null,
      }))
      if (s.creditName) credits.set(s.creditName, (credits.get(s.creditName) || 0) + 1)
      labels.set(s.label, (labels.get(s.label) || 0) + 1)
      total++
      if (total % 100 === 0) console.log(`  ${total} samples…`)
    }
    if (!next) break
    after = next
  }

  await writeFile(path.join(OUT, 'labels.csv'), csv.map((r) => r.map(csvCell).join(',')).join('\n') + '\n')
  await writeFile(path.join(OUT, 'labels.jsonl'), jsonl.join('\n') + '\n')

  const labelRows = [...labels.entries()].sort((a, b) => b[1] - a[1])
  await writeFile(
    path.join(OUT, 'label-counts.csv'),
    'label,samples\n' + labelRows.map(([l, n]) => `${csvCell(l)},${n}`).join('\n') + '\n',
  )

  const names = [...credits.keys()].sort((a, b) => a.localeCompare(b, 'km'))
  const creditsMd =
    '# Contributors\n\nThank you to everyone who signed Khmer words for this open dataset.\n\n' +
    (names.length ? names.map((n) => `- ${n} (${credits.get(n)})`).join('\n') : '_No opt-in credits yet._') +
    '\n'
  await writeFile(path.join(OUT, 'CREDITS.md'), creditsMd)

  console.log(`\nDone: ${total} samples across ${labels.size} signs, ${names.length} credited contributors`)
  console.log(`  ${path.join(OUT, 'labels.csv')}`)
  console.log(`  ${path.join(OUT, 'labels.jsonl')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
