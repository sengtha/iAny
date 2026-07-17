#!/usr/bin/env node
/**
 * Export the crowd-sourced Khmer voice clips into a training-ready dataset.
 *
 * Pulls every clip from the Worker admin API (metadata from D1, audio from R2),
 * writing:
 *   out/clips/<speaker>/<id>.wav        the 16 kHz mono recordings
 *   out/metadata.csv                    path,sentence,speaker,sentence_id,...
 *   out/CREDITS.md                      opt-in contributor names (for the release)
 *
 * metadata.csv matches §2 of docs/RUNPOD-KHMER-STT.md, so you can fold it
 * straight into the STT fine-tune.
 *
 * Usage:
 *   VOICE_ADMIN_TOKEN=xxxx node scripts/export-voice.mjs \
 *     [--base https://iany.sengtha.workers.dev] [--out ./out]
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
const BASE = opt('--base', process.env.VOICE_BASE || 'https://iany.sengtha.workers.dev').replace(/\/$/, '')
const OUT = opt('--out', './out')
const TOKEN = process.env.VOICE_ADMIN_TOKEN
if (!TOKEN) {
  console.error('Set VOICE_ADMIN_TOKEN (the Worker RADIO_ADMIN_TOKEN secret).')
  process.exit(1)
}
const auth = { authorization: `Bearer ${TOKEN}` }

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  await mkdir(path.join(OUT, 'clips'), { recursive: true })
  const rows = [['path', 'sentence', 'speaker', 'sentence_id', 'gender', 'age_band', 'region', 'duration_ms']]
  const credits = new Map() // creditName -> count
  let after = ''
  let total = 0
  let hours = 0

  for (;;) {
    const url = `${BASE}/voice/admin/clips?limit=300${after ? `&after=${encodeURIComponent(after)}` : ''}`
    const res = await fetch(url, { headers: auth })
    if (!res.ok) throw new Error(`list failed ${res.status}: ${await res.text()}`)
    const { clips, next } = await res.json()
    if (!clips.length) break

    for (const c of clips) {
      const dir = path.join(OUT, 'clips', c.speaker.replace(/[^a-z0-9-]/gi, '_'))
      await mkdir(dir, { recursive: true })
      const rel = path.join('clips', path.basename(dir), `${c.id}.wav`)
      const dest = path.join(OUT, rel)

      const a = await fetch(`${BASE}/voice/admin/clip/${c.id}`, { headers: auth })
      if (!a.ok) {
        console.warn(`  skip ${c.id}: audio ${a.status}`)
        continue
      }
      await pipeline(Readable.fromWeb(a.body), createWriteStream(dest))

      rows.push([rel, c.sentence, c.speaker, c.sentenceId, c.gender, c.ageBand, c.region, c.durationMs])
      if (c.creditName) credits.set(c.creditName, (credits.get(c.creditName) || 0) + 1)
      total++
      hours += (c.durationMs || 0) / 3600000
      if (total % 100 === 0) console.log(`  ${total} clips (${hours.toFixed(1)} h)…`)
    }
    if (!next) break
    after = next
  }

  await writeFile(path.join(OUT, 'metadata.csv'), rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n')

  const names = [...credits.keys()].sort((a, b) => a.localeCompare(b, 'km'))
  const creditsMd =
    '# Contributors\n\n' +
    'Thank you to everyone who lent their voice to this open Khmer speech dataset.\n\n' +
    (names.length ? names.map((n) => `- ${n} (${credits.get(n)})`).join('\n') : '_No opt-in credits yet._') +
    '\n'
  await writeFile(path.join(OUT, 'CREDITS.md'), creditsMd)

  console.log(`\nDone: ${total} clips, ${hours.toFixed(1)} h, ${names.length} credited contributors`)
  console.log(`  ${path.join(OUT, 'metadata.csv')}`)
  console.log(`  ${path.join(OUT, 'CREDITS.md')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
