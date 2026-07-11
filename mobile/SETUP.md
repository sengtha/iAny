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

## Build in the cloud with EAS (no Mac toolchain needed)

EAS Build compiles the app — including the native modules (llama.rn's
llama.cpp, op-sqlite + sqlite-vec) — **in Expo's cloud** and gives you an
installable APK. You don't need Android Studio, the Android SDK, or Xcode
locally. You need only: Node, an Expo account, and your phone.

```bash
cd mobile
npm install
npx expo install --fix          # reconcile native versions with the SDK

npm install -g eas-cli          # or use `npx eas-cli@latest` below
eas login                       # your Expo account
eas build:configure -p android  # adds a projectId to app.json (one time)
```

### The efficient loop (recommended)

Build the **development client once** — it contains all the native code — then
push every JS change (Stages 2–4) over Metro with no rebuild:

```bash
eas build --platform android --profile development
```

Wait ~15–25 min (first build compiles llama.cpp; later builds are cached).
When it finishes you get a URL/QR — install that APK on your phone. Then:

```bash
npx expo start --dev-client
```

Open the installed **iAny (dev)** app; it loads the JS from your machine over
Wi-Fi and hot-reloads. Because Stages 2–4 only change JavaScript (embeddings
and generation both run through llama.rn, which is already compiled in), you
**never rebuild** unless we add a new native dependency.

### Standalone offline APK (for real offline testing / sharing)

At milestones, build a self-contained APK that needs no computer:

```bash
eas build --platform android --profile preview
```

Download the APK, enable "install unknown apps," install, and run it fully
offline.

> **Monorepo note:** the app lives in `mobile/` inside the iAny git repo. Run
> all `eas` commands from `mobile/`. If EAS complains about the git root or
> uploads the whole repo, prefix the build with `EAS_NO_VCS=1` — it archives
> the `mobile/` directory directly instead of going through git.

## Local build (alternative, needs the toolchain)

If you'd rather build on your own Mac:

```bash
cd mobile && npm install && npx expo install --fix
npx expo prebuild
npx expo run:android   # connected phone/emulator; run:ios on a Mac
```

## Native modules per stage

To keep each cloud build small and easy to debug, native modules are added
only when the code actually uses them:

- **Stage 1 (now):** `@op-engineering/op-sqlite` only. FTS-only retrieval.
- **Stage 2:** re-enable sqlite-vec by adding this block back to
  `package.json`, which makes op-sqlite compile the extension in:
  ```json
  "op-sqlite": { "sqliteVec": true }
  ```
  The DB layer already detects the `vec0` module at runtime (`vecEnabled`) and
  switches on vector + hybrid search automatically — no caller changes.
- **Stage 3:** add `llama.rn` (llama.cpp) for on-device Gemma generation.

Adding a native module means the next EAS build recompiles native (longer),
which is expected.

## Testing Stage 1 on the phone

1. Build and launch (above).
2. Paste some Khmer or English text, give it a title, tap **Add**.
3. Search a word or phrase from it — you should get ranked chunk hits.
   Trigram FTS matches Khmer without needing word spaces.

If that works, the storage foundation is proven and we move to Stage 2
(embeddings) then Stage 3 (Gemma generation).
