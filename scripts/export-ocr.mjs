#!/usr/bin/env node
/**
 * Export the crowd-sourced Khmer OCR samples into a training-ready dataset.
 *
 * Pulls every sample from the Worker admin API (metadata from D1, images from
 * R2), writing:
 *   out/images/<id>.jpg          the photos
 *   out/labels.jsonl             {image, text, ocr_guess, region, w, h} per line
 *   out/metadata.csv             image,text  (simple two-column form)
 *   out/CREDITS.md               opt-in contributor names (for the release)
 *
 * Usage:
 *   OCR_ADMIN_TOKEN=xxxx node scripts/export-ocr.mjs \
 *     [--base https://iany.app] [--out ./ocr-out]
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
const BASE = opt('--base', process.env.OCR_BASE || 'https://iany.app').replace(/\/$/, '')
const OUT = opt('--out', './ocr-out')
const TOKEN = process.env.OCR_ADMIN_TOKEN
if (!TOKEN) {
  console.error('Set OCR_ADMIN_TOKEN (the Worker RADIO_ADMIN_TOKEN secret).')
  process.exit(1)
}
const auth = { authorization: `Bearer ${TOKEN}` }

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  await mkdir(path.join(OUT, 'images'), { recursive: true })
  const csv = [['image', 'text']]
  const jsonl = []
  const credits = new Map()
  let after = ''
  let total = 0

  for (;;) {
    const url = `${BASE}/api/ocr/admin/samples?limit=300${after ? `&after=${encodeURIComponent(after)}` : ''}`
    const res = await fetch(url, { headers: auth })
    if (!res.ok) throw new Error(`list failed ${res.status}: ${await res.text()}`)
    const { samples, next } = await res.json()
    if (!samples.length) break

    for (const s of samples) {
      const rel = path.join('images', `${s.id}.jpg`)
      const img = await fetch(`${BASE}/api/ocr/admin/image/${s.id}`, { headers: auth })
      if (!img.ok) {
        console.warn(`  skip ${s.id}: image ${img.status}`)
        continue
      }
      await pipeline(Readable.fromWeb(img.body), createWriteStream(path.join(OUT, rel)))
      csv.push([rel, s.text])
      jsonl.push(JSON.stringify({
        image: rel, text: s.text, ocr_guess: s.ocrGuess ?? null,
        region: s.region ?? null, width: s.width ?? null, height: s.height ?? null,
      }))
      if (s.creditName) credits.set(s.creditName, (credits.get(s.creditName) || 0) + 1)
      total++
      if (total % 100 === 0) console.log(`  ${total} samples…`)
    }
    if (!next) break
    after = next
  }

  await writeFile(path.join(OUT, 'metadata.csv'), csv.map((r) => r.map(csvCell).join(',')).join('\n') + '\n')
  await writeFile(path.join(OUT, 'labels.jsonl'), jsonl.join('\n') + '\n')

  const names = [...credits.keys()].sort((a, b) => a.localeCompare(b, 'km'))
  const creditsMd =
    '# Contributors\n\nThank you to everyone who photographed and labeled Khmer text for this open dataset.\n\n' +
    (names.length ? names.map((n) => `- ${n} (${credits.get(n)})`).join('\n') : '_No opt-in credits yet._') +
    '\n'
  await writeFile(path.join(OUT, 'CREDITS.md'), creditsMd)

  console.log(`\nDone: ${total} samples, ${names.length} credited contributors`)
  console.log(`  ${path.join(OUT, 'metadata.csv')}`)
  console.log(`  ${path.join(OUT, 'labels.jsonl')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
