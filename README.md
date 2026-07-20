# iAny

**Feed AI from anything. The more you feed it, the smarter it gets — 100% offline, on your device.**

iAny is an offline-first RAG (retrieval-augmented generation) PWA. You feed it text and documents; it chunks, embeds and indexes them in a real Postgres database running inside your browser. Then you ask questions — in **Khmer or English** — and a local LLM answers grounded in your own knowledge, with sources. Nothing ever leaves your device.

## Tech stack

| Layer | Technology |
|---|---|
| App | React 19 + Vite + TypeScript, installable PWA (`vite-plugin-pwa`) |
| Database | [PGlite](https://pglite.dev) (WASM Postgres) + [pgvector](https://github.com/pgvector/pgvector), persisted to IndexedDB, running in a Web Worker |
| Embeddings | [EmbeddingGemma 300M](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX) via [Transformers.js](https://huggingface.co/docs/transformers.js), truncated to 256 dims (Matryoshka) |
| Generation | [Gemma 4 E2B](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX) via Transformers.js on WebGPU |
| Retrieval | Hybrid search: HNSW cosine similarity + Postgres full-text search, fused with reciprocal rank fusion |
| Sync (planned) | ElectricSQL — the schema is already sync-ready (UUIDs, `updated_at`, soft deletes) |

## Architecture

```
UI (React PWA, service worker precaches the full app shell incl. WASM)
 │
 ├─ AI Worker ─── Transformers.js
 │     ├─ EmbeddingGemma 300M  (ingest + query embedding, WebGPU or WASM)
 │     └─ Gemma 4 E2B          (answers, WebGPU only — search mode elsewhere)
 │
 └─ DB Worker ─── PGlite (idb://iany-db)
       ├─ chunks.embedding vector(256)  → HNSW index (semantic search)
       ├─ chunks.tsv tsvector           → GIN index (keyword search)
       └─ hybrid ranking via reciprocal rank fusion
```

- `src/ai/` — AI worker, RPC client, Khmer-aware chunker
- `src/db/` — DB worker, schema, hybrid search, documents, knowledge packs
- `src/rag/` — ingest (feed) and ask (retrieve + generate) pipelines
- `src/i18n/` — English and Khmer UI translations
- `src/views/` — Chat, Library, Packs, Settings

## Khmer support

Khmer is written without spaces between words, which breaks conventional
full-text search. iAny uses `Intl.Segmenter`'s ICU dictionary segmentation
(built into every modern browser) to split Khmer into words at ingest time
(`ភ្នំពេញជារាជធានី` → `ភ្នំពេញ ជា រាជធានី`) and indexes the result with
Postgres FTS. Sentence segmentation (for chunking) handles the Khmer khan
(។) the same way. EmbeddingGemma is multilingual (100+ languages including
Khmer), so semantic search works in both languages out of the box, and
cross-language retrieval (ask in Khmer, find English content) comes free.

**Accessibility — Khmer Braille:** the `/braille` page (and `@iany/core`'s
`khmerToBraille` / `khmerToBrf`) convert Khmer text to Unicode Braille and BRF
embosser files, offline. See **[docs/KHMER-BRAILLE.md](docs/KHMER-BRAILLE.md)**
for usage, the algorithm, and how to verify/port it.

## Knowledge packs

A **pack** is iAny's portability primitive: a self-contained JSON bundle of
documents + chunks + embeddings. Because every iAny install pins the same
embedding model and dimensions, packs import with zero re-embedding and are
instantly searchable. Packs serve as manual backup/device transfer today and
are the foundation for pack sharing and a future marketplace. Source text is
always included (RAG needs it, and it makes packs survivable across future
embedding-model upgrades).

## Models

All of iAny's models download once from Hugging Face and are cached on-device,
then work fully offline. The app asks the browser for persistent storage so
neither the models nor your knowledge base get evicted.

**Answering + search** (PWA):

- **EmbeddingGemma 300M** (q4, ~200 MB) — required; loads on first feed/search.
- **iAny Khmer** (~270M, the small default) or **Gemma 4 E2B** (q4f16, ~1.5 GB,
  needs WebGPU) — the answering model. Without a generator iAny runs in **search
  mode**: you still get the most relevant passages, just not a generated answer.

### Open Khmer models — 🤗 https://huggingface.co/sengtha

iAny publishes its Khmer models open source. Browse them all on the profile
above; the full catalog (purpose, format, license lineage) is in
**[docs/MODELS.md](docs/MODELS.md)**.

| Model | Purpose |
|---|---|
| [iany-khmer-tiny-v1-ONNX](https://huggingface.co/sengtha/iany-khmer-tiny-v1-ONNX) · [Qwen3-0.6B-khm-ft3-…-GGUF](https://huggingface.co/sengtha/Qwen3-0.6B-khm-ft3-Q8_0-GGUF) | Khmer answering LLM (PWA / mobile) |
| [whisper-base-khmer](https://huggingface.co/sengtha/whisper-base-khmer) | Khmer speech-to-text (STT) — ONNX (PWA) + GGML (mobile) |
| [khmer-tts-female-v2](https://huggingface.co/sengtha/khmer-tts-female-v2) | Khmer text-to-speech (TTS) |
| [khmer-ocr](https://huggingface.co/sengtha/khmer-ocr) | Khmer OCR (detector + recognizer) |
| [iany-waste-v1](https://huggingface.co/sengtha/iany-waste-v1) | Waste-material classifier (ONNX) — live `/waste-scan` |

**Open datasets** (released from community contributions, CC-BY-SA-4.0):

| Dataset | Purpose |
|---|---|
| 🎤 [sengtha/iany-khmer-voice](https://huggingface.co/datasets/sengtha/iany-khmer-voice) | Khmer read speech from `/voice`, for open STT — **live & growing** |

> Models and datasets carry their **own licenses**, separate from iAny's
> Apache-2.0 **code** license — each Hugging Face repo card is authoritative.
> Help grow them by contributing at `/voice`, `/scan`, and `/sign`.

## Development

```bash
npm install          # ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install if the
                     # onnxruntime-node postinstall can't reach the network
npm run dev          # dev server
npm run build        # typecheck + production build
npm run preview      # serve the production build
node scripts/generate-icons.mjs   # regenerate PWA icons from public/icon.svg
```

## Deployment (Cloudflare Workers)

iAny deploys on Cloudflare Workers (`wrangler.jsonc`): static assets plus
a small edge worker (`worker/index.ts`) that acts as a **pull-through
model mirror**. The app downloads models from `/models/*` on its own
origin; on a cache miss the worker fetches the file from Hugging Face
through Cloudflare's network, streams it to the client and stores it in
R2 in the same pass. This matters because many client networks (mobile
carriers, filtered Wi-Fi) cannot reach huggingface.co directly — after
the first download, models are served entirely from R2 with free egress.

```bash
npx wrangler login                         # once
npx wrangler r2 bucket create iany-models  # once
npm run deploy                             # build + wrangler deploy
```

Set localStorage `iany.modelHost` to override the model source (e.g.
`https://huggingface.co` to bypass the mirror during local development).
Settings → "Test model download connections" probes each hop on-device.

Or connect the repo with Workers Builds for deploy-on-push: build command
`npm run build`, deploy command `npx wrangler deploy`, and set the build
environment variable `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` (the
onnxruntime-node postinstall otherwise tries to download CUDA binaries and
can fail CI).

When the v2 API lands, add `"main": "worker/index.ts"` plus R2/D1 bindings
to `wrangler.jsonc`; Worker routes automatically take precedence over
static assets.

## Sharing models between devices (no internet)

Settings → AI models → **Export**: bundles a downloaded model's cached
weights into a single `.iany-model` file you can move via Quick Share,
USB or SD card, then **Import** on the receiving device — the model is
ready with zero download. One person downloads once and can seed many
offline devices.

## Cloud backup (v2, beta)

Settings → **Cloud backup** encrypts your knowledge base on-device
(AES-GCM; key derived from a recovery code that never leaves the device)
and stores the ciphertext via `/api/backup/*` in R2. Restoring on a new
device just needs the recovery code. The server cannot read backups —
losing the code means losing the backup. Free during beta; the future
credits system will gate this endpoint.

## Roadmap

1. **v1 (done)** — offline feed/ask, hybrid Khmer/English retrieval,
   knowledge packs, model mirror, device-to-device model sharing.
2. **v2 (in progress)** — encrypted cloud backup/restore (done, beta);
   next: credits & payments, live multi-device sync via ElectricSQL.
3. **v3** — knowledge pack marketplace (buy/sell packs, platform fee).

## License

iAny's **source code is licensed under [Apache-2.0](LICENSE)** — free to use,
modify, and build on, including for commercial products, with an explicit patent
grant. See [NOTICE](NOTICE) for third-party attributions.

> The code license covers **code only.** Machine-learning **models** and
> **datasets** carry their own licenses (e.g. community datasets are
> CC-BY-SA-4.0, some models follow Google's Gemma Terms). See [NOTICE](NOTICE).

## Open source & commercial

iAny is fully open source *and* a sustainable project. Revenue comes from
building on it, support, a hosted service + credits, B2B/B2G contracts, and
grants — **not** from restricting the code. Anyone may build derivative products.
See [COMMERCIAL.md](COMMERCIAL.md) for the full model, and
[CONTRIBUTING.md](CONTRIBUTING.md) to get involved.

## Trademark

The Apache-2.0 license grants rights to the **code, not the name.** **"iAny"**
and the iAny logo are trademarks of **[E-KHMER Technology Co., Ltd](https://www.e-khmer.com)**.
You're free to build and even sell products from this code, but please give your
product **its own name** and don't imply it's the official iAny or endorsed by
it. Nominative use ("built with iAny", "based on iAny") is fine.

## Security

Found a vulnerability? Please report it privately — see [SECURITY.md](SECURITY.md).
Do not open a public issue.
