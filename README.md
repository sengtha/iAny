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

## Knowledge packs

A **pack** is iAny's portability primitive: a self-contained JSON bundle of
documents + chunks + embeddings. Because every iAny install pins the same
embedding model and dimensions, packs import with zero re-embedding and are
instantly searchable. Packs serve as manual backup/device transfer today and
are the foundation for pack sharing and a future marketplace. Source text is
always included (RAG needs it, and it makes packs survivable across future
embedding-model upgrades).

## Models

Both models download once from Hugging Face and are cached by the browser
(Cache API), then work fully offline:

- **EmbeddingGemma 300M** (q4, ~200 MB) — required; loads on first feed/search.
- **Gemma 4 E2B** (q4f16, ~1.5 GB) — optional, needs WebGPU (desktop
  Chrome/Edge). Without it iAny runs in **search mode**: you still get the
  most relevant passages, just not a generated answer.

The app asks the browser for persistent storage so neither the models nor
your knowledge base get evicted.

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

iAny deploys as static assets on Cloudflare Workers (`wrangler.jsonc`) —
free unlimited bandwidth, which matters because the offline app shell is
~37 MB of precached WASM.

```bash
npx wrangler login    # once
npm run deploy        # build + wrangler deploy
```

Or connect the repo with Workers Builds for deploy-on-push: build command
`npm run build`, deploy command `npx wrangler deploy`, and set the build
environment variable `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` (the
onnxruntime-node postinstall otherwise tries to download CUDA binaries and
can fail CI).

When the v2 API lands, add `"main": "worker/index.ts"` plus R2/D1 bindings
to `wrangler.jsonc`; Worker routes automatically take precedence over
static assets.

## Roadmap

1. **v1 (this)** — offline feed/ask, hybrid Khmer/English retrieval, packs.
2. **v2** — cloud backup & multi-device sync via ElectricSQL (paid credits).
3. **v3** — knowledge pack marketplace (buy/sell packs, platform fee).
