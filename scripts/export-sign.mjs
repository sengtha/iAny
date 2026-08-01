#!/usr/bin/env node
/**
 * Export the crowd-sourced Khmer Sign Language samples into a training-ready set.
 *
 * Pulls everything from the Worker admin API (metadata from D1, sequences and
 * videos from R2) and writes a ready-to-publish Hugging Face dataset repo:
 *
 *   out/landmarks/train.jsonl    one sample per line, frames INLINE (loads directly)
 *   out/sequences/<id>.json      the same sequences as individual files
 *   out/videos/<id>.<ext>        uploaded KSL videos (the /sign "Upload a video" mode)
 *   out/videos/metadata.csv      file_name,label,region,…  (HF videofolder convention)
 *   out/labels.csv               seq,label  (simple two-column form)
 *   out/label-counts.csv         how many samples per sign (spot thin coverage)
 *   out/README.md                dataset card (YAML + license + usage)
 *   out/CREDITS.md               opt-in contributor names (for the release)
 *
 * Two modalities, two licences of risk: the landmark sequences carry no face or
 * background at all, while an uploaded video is real footage its contributor
 * owned and explicitly agreed to release. Both are separated in the layout so a
 * consumer can take only what it wants.
 *
 * Usage:
 *   SIGN_ADMIN_TOKEN=xxxx node scripts/export-sign.mjs \
 *     [--base https://iany.app] [--out ./sign-out] [--repo sengtha/iany-khmer-sign]
 *
 * Publish to Hugging Face (after export):
 *   huggingface-cli upload <repo> ./sign-out --repo-type dataset
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
const REPO = opt('--repo', process.env.SIGN_HF_REPO || 'sengtha/iany-khmer-sign')
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
  await mkdir(path.join(OUT, 'landmarks'), { recursive: true })
  const csv = [['seq', 'label']]
  const jsonl = []
  const inline = [] // frames embedded → `load_dataset('json', …)` works with no glue
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
      // Keep the standalone file AND fold the frames into the JSONL, so the
      // dataset loads on the Hub without a custom loading script.
      const seqJson = await seq.json()
      await writeFile(path.join(OUT, rel), JSON.stringify(seqJson))
      inline.push(JSON.stringify({
        label: s.label, prompt_id: s.promptId ?? null, fps: seqJson.fps ?? null,
        frames: seqJson.frames ?? [], n_frames: s.frames ?? null,
        hand_frames: s.handFrames ?? null, region: s.region ?? null, sample_id: s.id,
      }))
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
  await writeFile(path.join(OUT, 'landmarks', 'train.jsonl'), inline.join('\n') + '\n')

  // ---- uploaded videos (the /sign "Upload a video" mode) --------------------
  const vids = [['file_name', 'label', 'region', 'credit_name', 'bytes', 'created_at']]
  const videoLabels = new Set()
  let videoCount = 0
  try {
    let vafter = ''
    for (;;) {
      const url = `${BASE}/api/sign/admin/videos?limit=200${vafter ? `&after=${encodeURIComponent(vafter)}` : ''}`
      const res = await fetch(url, { headers: auth })
      if (!res.ok) break // node not migrated / no videos yet — landmarks still export
      const { videos, next } = await res.json()
      if (!videos?.length) break
      if (videoCount === 0) await mkdir(path.join(OUT, 'videos'), { recursive: true })
      for (const v of videos) {
        const ext = (v.mime || '').split('/')[1]?.replace('quicktime', 'mov').replace('x-matroska', 'mkv') || 'mp4'
        const name = `${v.id}.${ext}`
        const bin = await fetch(`${BASE}/api/sign/admin/video/${v.id}`, { headers: auth })
        if (!bin.ok) { console.warn(`  skip video ${v.id}: ${bin.status}`); continue }
        await pipeline(Readable.fromWeb(bin.body), createWriteStream(path.join(OUT, 'videos', name)))
        vids.push([name, v.label, v.region ?? '', v.creditName ?? '', v.bytes ?? '', v.createdAt ?? ''])
        if (v.creditName) credits.set(v.creditName, (credits.get(v.creditName) || 0) + 1)
        videoLabels.add(v.label) // counted separately: a video captions a phrase,
        videoCount++             // a landmark sample is one sign — don't conflate

        if (videoCount % 20 === 0) console.log(`  ${videoCount} videos…`)
      }
      if (!next) break
      vafter = next
    }
  } catch (e) {
    console.warn(`  videos skipped: ${e.message}`)
  }
  if (videoCount > 0) {
    await writeFile(
      path.join(OUT, 'videos', 'metadata.csv'),
      vids.map((r) => r.map(csvCell).join(',')).join('\n') + '\n',
    )
  }

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

  await writeFile(path.join(OUT, 'README.md'), datasetCard({
    repo: REPO, samples: total, videos: videoCount, signs: labels.size,
    phrases: videoLabels.size, credited: names.length,
  }))

  console.log(`\nDone: ${total} landmark samples across ${labels.size} signs · ${videoCount} videos across ${videoLabels.size} phrases · ${names.length} credited contributors`)
  console.log(`  ${path.join(OUT, 'landmarks', 'train.jsonl')}`)
  console.log(`  ${path.join(OUT, 'label-counts.csv')}`)
  console.log(`  ${path.join(OUT, 'README.md')} (dataset card)`)
  console.log(`\nPublish:`)
  console.log(`  huggingface-cli upload ${REPO} ${OUT} --repo-type dataset`)
}

/** A Hugging Face dataset card (README.md) with YAML metadata + usage. */
function datasetCard({ repo, samples, videos, signs, phrases, credited }) {
  return `---
license: cc-by-sa-4.0
language:
- km
task_categories:
- video-classification
tags:
- khmer
- sign-language
- ksl
- hand-landmarks
- mediapipe
- accessibility
- iany
pretty_name: iAny Khmer Sign Language
size_categories:
- n<1K
---

# iAny Khmer Sign Language (KSL)

An open, community-contributed **Khmer Sign Language** dataset — built with and
for the Deaf community in Cambodia, collected at [iany.app/sign](https://iany.app/sign).

- **${samples}** landmark sequences across **${signs}** distinct signs
- **${videos}** uploaded videos across **${phrases}** captioned phrases
- **${credited}** contributors opted in to be credited (see \`CREDITS.md\`)

## Two modalities

| Part | What it is | Privacy |
|---|---|---|
| \`landmarks/\` | per-frame **hand skeletons** (21 MediaPipe keypoints/hand) | no video, no face, no background — cannot identify anyone |
| \`videos/\` | whole KSL clips their contributor **owned and agreed to release** | real footage; treat as identifiable |

Most of the set is landmarks: the live collector records *only* hand positions,
never the camera image. Videos exist only where someone deliberately uploaded one.

## Layout

\`\`\`
landmarks/train.jsonl   label, frames (inline), fps, n_frames, hand_frames, region
sequences/<id>.json     the same sequences as individual files
videos/<id>.<ext>       uploaded videos
videos/metadata.csv     file_name, label, region, credit_name, …
labels.csv              seq,label
label-counts.csv        landmark samples per sign — spot thin coverage before training
\`\`\`

## Usage

\`\`\`python
from datasets import load_dataset

# hand-landmark sequences (the main training signal)
ds = load_dataset("${repo}", data_files="landmarks/train.jsonl", split="train")
print(ds[0]["label"], len(ds[0]["frames"]))

# uploaded videos, if you want raw footage
vids = load_dataset("videofolder", data_dir="videos")
\`\`\`

Each landmark frame is \`{"hands": [[[x, y, z], … 21 points], …]}\` with
coordinates normalized to the image (0–1). A sequence is variable length —
the classic setup for gesture recognition (pad/mask + GRU/Transformer, or a
lightweight temporal CNN).

## Licence & consent

CC-BY-SA-4.0. Every contributor explicitly consented to their contribution being
released as an open dataset and used to train and share a free model. The only
identifier stored is a random per-device id; a real name appears **only** where
someone opted into the credit field.

## Caveats

- Sign vocabulary and regional variation are uneven — check \`label-counts.csv\`
  before assuming coverage.
- Landmarks come from MediaPipe Hand Landmarker; failures (occlusion, motion
  blur) show up as frames with fewer hands.
- Non-manual markers (face, mouth, body) are **not** captured in the landmark
  half. KSL, like every sign language, uses them — models trained only on hands
  will miss meaning that native signers rely on.
`
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
