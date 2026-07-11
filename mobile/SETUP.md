# iAny — Native (React Native / Expo)

The native app. It reuses iAny's RAG design (chunking, hybrid retrieval, RRF)
but swaps the browser-only pieces for native equivalents that run properly on
a phone — including the Galaxy S10 that crashes the PWA.

| PWA | Native |
| --- | --- |
| PGlite (Postgres WASM) | **op-sqlite** (native SQLite) |
| pgvector (HNSW) | **sqlite-vec** (vec0 KNN) |
| Postgres FTS (`tsvector`) | **FTS5** (`trigram` tokenizer — Khmer-safe) |
| Transformers.js (Gemma) | **llama.rn** (llama.cpp, GGUF) — *Stage 3* |
| `Intl.Segmenter` | punctuation/khan splitter (Hermes has no Segmenter) |

## Status

- **Stage 1 (this):** project + on-device SQLite ingest + FTS retrieval. A
  smoke-test screen proves feed → search works on the phone.
- Stage 2: on-device embeddings → real vector + hybrid search.
- Stage 3: on-device Gemma generation (llama.rn).
- Stage 4: full UI (Chat/Library/Settings) + Khmer/English i18n.

> These native modules need a **custom dev build** — they do **not** run in
> Expo Go. That's expected.

## Prerequisites (macOS)

- Node 20+
- **Android:** Android Studio + an SDK/emulator (or a USB device with USB
  debugging). Your Galaxy S10 works here.
- **iOS:** Xcode + CocoaPods (`sudo gem install cocoapods`).

## Build & run

```bash
cd mobile
npm install

# Reconcile native module versions with the installed Expo SDK.
npx expo install --fix

# Generate the native android/ and ios/ projects.
npx expo prebuild

# Run on a connected Android phone/emulator:
npx expo run:android

# …or iOS (Mac only):
npx expo run:ios
```

`expo run:*` compiles the dev build, installs it, and starts Metro. After the
first build you can just `npm start` and reopen the installed dev app.

## sqlite-vec

Vector search comes from the sqlite-vec extension, enabled via this block in
`package.json`:

```json
"op-sqlite": { "sqliteVec": true }
```

op-sqlite bundles and registers the extension at build time when this flag is
set — no runtime `load_extension` call. If `CREATE VIRTUAL TABLE ... USING
vec0` throws, the flag didn't take: re-run `npx expo prebuild --clean` then
rebuild. Stage 1 works without it (FTS-only); it becomes load-bearing in
Stage 2.

## Testing Stage 1 on the phone

1. Build and launch (above).
2. Paste some Khmer or English text, give it a title, tap **Add**.
3. Search a word or phrase from it — you should get ranked chunk hits.
   Trigram FTS matches Khmer without needing word spaces.

If that works, the storage foundation is proven and we move to Stage 2
(embeddings) then Stage 3 (Gemma generation).
