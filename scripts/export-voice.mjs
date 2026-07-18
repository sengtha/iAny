#!/usr/bin/env node
/**
 * Export the crowd-sourced Khmer voice clips into a training-ready dataset.
 *
 * Pulls every clip from the Worker admin API (metadata from D1, audio from R2),
 * writing a ready-to-publish Hugging Face **audiofolder** dataset:
 *   out/clips/<speaker>/<id>.wav        the 16 kHz mono recordings
 *   out/metadata.csv                    file_name,sentence,speaker,sentence_id,...
 *   out/README.md                       dataset card (license, stats, usage)
 *   out/CREDITS.md                      opt-in contributor names (for the release)
 *
 * The `file_name` column makes `out/` load directly as a HF audiofolder, and it
 * also folds straight into §2 of docs/RUNPOD-KHMER-STT.md for the STT fine-tune.
 *
 * Usage:
 *   VOICE_ADMIN_TOKEN=xxxx node scripts/export-voice.mjs \
 *     [--base https://iany.app] [--out ./out] [--repo sengtha/iany-khmer-voice]
 *
 * Publish to Hugging Face (after export):
 *   huggingface-cli upload <repo> ./out --repo-type dataset
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
const BASE = opt('--base', process.env.VOICE_BASE || 'https://iany.app').replace(/\/$/, '')
const OUT = opt('--out', './out')
const REPO = opt('--repo', process.env.VOICE_HF_REPO || 'sengtha/iany-khmer-voice')
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
  // `file_name` (not `path`) is the HF audiofolder convention, so `out/` loads
  // directly with `load_dataset(...)`.
  const rows = [['file_name', 'sentence', 'speaker', 'sentence_id', 'gender', 'age_band', 'region', 'duration_ms']]
  const credits = new Map() // creditName -> count
  const speakers = new Set()
  let after = ''
  let total = 0
  let hours = 0

  for (;;) {
    const url = `${BASE}/api/voice/admin/clips?limit=300${after ? `&after=${encodeURIComponent(after)}` : ''}`
    const res = await fetch(url, { headers: auth })
    if (!res.ok) throw new Error(`list failed ${res.status}: ${await res.text()}`)
    const { clips, next } = await res.json()
    if (!clips.length) break

    for (const c of clips) {
      const dir = path.join(OUT, 'clips', c.speaker.replace(/[^a-z0-9-]/gi, '_'))
      await mkdir(dir, { recursive: true })
      const rel = path.join('clips', path.basename(dir), `${c.id}.wav`)
      const dest = path.join(OUT, rel)

      const a = await fetch(`${BASE}/api/voice/admin/clip/${c.id}`, { headers: auth })
      if (!a.ok) {
        console.warn(`  skip ${c.id}: audio ${a.status}`)
        continue
      }
      await pipeline(Readable.fromWeb(a.body), createWriteStream(dest))

      rows.push([rel, c.sentence, c.speaker, c.sentenceId, c.gender, c.ageBand, c.region, c.durationMs])
      if (c.creditName) credits.set(c.creditName, (credits.get(c.creditName) || 0) + 1)
      speakers.add(c.speaker)
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

  // Hugging Face dataset card — makes `out/` a publish-ready dataset repo.
  await writeFile(path.join(OUT, 'README.md'), datasetCard({
    repo: REPO, clips: total, speakers: speakers.size, hours, credited: names.length,
  }))

  console.log(`\nDone: ${total} clips, ${hours.toFixed(1)} h, ${speakers.size} speakers, ${names.length} credited`)
  console.log(`  ${path.join(OUT, 'metadata.csv')}`)
  console.log(`  ${path.join(OUT, 'README.md')} (dataset card)`)
  console.log(`  ${path.join(OUT, 'CREDITS.md')}`)
  console.log(`\nPublish to Hugging Face:`)
  console.log(`  huggingface-cli upload ${REPO} ${OUT} --repo-type dataset`)
}

function sizeCategory(n) {
  if (n < 1000) return 'n<1K'
  if (n < 10000) return '1K<n<10K'
  if (n < 100000) return '10K<n<100K'
  return '100K<n<1M'
}

/** A Hugging Face dataset card (README.md) with YAML metadata + usage. */
function datasetCard({ repo, clips, speakers, hours, credited }) {
  return `---
license: cc-by-sa-4.0
task_categories:
- automatic-speech-recognition
language:
- km
tags:
- khmer
- cambodia
- speech
- asr
- iany
pretty_name: iAny Khmer Voice
size_categories:
- ${sizeCategory(clips)}
---

# iAny Khmer Voice

An open, community-contributed **Khmer speech dataset** for training speech-to-text
(ASR). Recorded through the iAny "Contribute your voice" page
(https://iany.app/voice), where people read short Khmer sentences aloud —
**with the community, for the community.**

- **Clips:** ${clips}
- **Speakers:** ${speakers} (anonymous ids)
- **Duration:** ${hours.toFixed(1)} hours
- **Audio:** 16 kHz mono WAV
- **Language:** Khmer (\`km\`)
- **License:** CC-BY-SA-4.0

## Structure

Standard Hugging Face *audiofolder*:

- \`clips/<speaker>/<id>.wav\` — the recordings
- \`metadata.csv\` — \`file_name, sentence, speaker, sentence_id, gender, age_band, region, duration_ms\`

## Usage

\`\`\`python
from datasets import load_dataset
ds = load_dataset("${repo}")            # or load_dataset("audiofolder", data_dir="./out")
print(ds["train"][0])                   # {'audio': {...}, 'sentence': 'សួស្ដី ...', 'speaker': 's-...'}
\`\`\`

## Privacy & consent

Contributors opted in to release their recordings as an open dataset. \`speaker\`
is a random, anonymous per-device id — never a name. A real name appears only in
\`CREDITS.md\`, and only if a contributor chose to add one. Please use the data
respectfully and keep derivatives open (share-alike).

## Credits

Thank you to all ${speakers} speakers (${credited} added their name — see
\`CREDITS.md\`). Built by [E-KHMER Technology Co., Ltd](https://www.e-khmer.com).

## Citation

\`\`\`
iAny Khmer Voice. E-KHMER Technology Co., Ltd. https://iany.app · CC-BY-SA-4.0
\`\`\`
`
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
