# iAny unified architecture — one brain, two shells

## The problem

iAny is two apps that do the *same thing* twice:

| | PWA (repo root) | Mobile (`mobile/`) |
|---|---|---|
| UI | React 19 + Vite | React 18.3 + Expo/RN |
| Storage | PGlite + sqlite-vec | op-sqlite (FTS5 + sqliteVec) |
| Embeddings | transformers.js (ONNX) | llama.rn (GGUF) |
| Generation | transformers.js / ort-web | llama.rn (GGUF) |
| TTS | — | onnxruntime-react-native + expo-av |
| Types / chunking / prompt | `src/types.ts`, `src/rag/*` | `mobile/src/**` (drifted copy) |

The **runtimes must differ** — a browser can't load a GGUF via llama.rn, and a
phone can't run transformers.js well. That's fine. The bug is that the **brain**
— domain types, chunking, retrieval flow, the RAG prompt, TTS text rules, the
pack format — was **copied and has drifted**. Two prompts, two chunkers, two
`types.ts`. That's how packs stop being portable and answers differ per device.

## The design: shared core + platform engines

```
                 ┌──────────────────────────────┐
                 │        @iany/core             │  ← the brain (pure TS)
                 │  types · chunking · prompt ·  │    no DOM, no RN, no Node
                 │  ask() flow · TTS text ·      │
                 │  pack format · radio contracts│
                 └──────────────┬───────────────┘
        implements Engine       │        implements Engine
     ┌──────────────────────────┴───────────────────────────┐
     │                                                       │
┌────▼───────────────┐                          ┌────────────▼────────┐
│  PWA shell (web)   │                          │  mobile shell (RN)  │
│  PGlite storage    │                          │  op-sqlite storage  │
│  transformers.js   │                          │  llama.rn generator │
│  ort-web / WebAudio│                          │  onnxruntime-rn TTS │
│  React 19 UI       │                          │  React 18 UI        │
└────────────────────┘                          └─────────────────────┘
```

**Core owns the flow; platforms own the wiring.** `ask()` lives in core and calls
`Storage.hybridSearch → buildRagMessages → Generator.generate`. Each platform
implements `Storage`, `Embedder`, `Generator`, `Tts` (see `engine.ts`) over its
own libraries. Add a Raspberry Pi / desktop tier later by implementing those four
interfaces — never by re-forking the brain.

### Why not one UI codebase (Expo-web / RN-Web)?

Considered and rejected for now: it would force React 19 → 18, throw away the
PWA's mature web AI stack (transformers.js, PGlite, tesseract), and rebuild every
web-only capability inside RN primitives. High risk, deletes working code. The
**shared-core** approach unifies the 90% that matters (behavior, data, packs)
while keeping each platform's best-in-class runtime. Two thin shells over one
brain — not two brains, and not one crippled brain.

## What's portable, guaranteed by core

- **Knowledge packs** (`iany-pack/1`) — same manifest, same chunking, same
  256-dim EmbeddingGemma space → a pack made in the browser opens on the phone.
- **The RAG prompt** — `buildRagPrompt` is the *same string* used to SFT the
  Khmer model, so training and inference match on both platforms.
- **TTS text rules** — `normalizeNumbers` (Khmer number words) so the voice says
  `២០` as "ម្ភៃ" identically everywhere.
- **Chunking** — `chunkText` is the one splitter; identical chunks or packs don't
  line up.

## Migration (phased, non-breaking — this is the important part)

Two live, working apps. We do **not** rewrite them in one shot.

- **Phase 1 — core exists (DONE).** `packages/core` holds the unified types,
  chunking, prompt, TTS text, engine interfaces, and radio contracts. Nothing
  consumes it yet, so nothing breaks.
- **Phase 2 — PWA adopts core.** Add `@iany/core` via a workspace, re-point
  `src/types.ts` and `src/rag/*` to re-export from core, delete the duplicates.
  Vite resolves TS sources directly. Verify the web build.
- **Phase 3 — mobile adopts core.** Add the workspace + Metro `watchFolders` for
  `../packages/core`, re-point `mobile/src/domain/*`, `ai/ask.ts`, `ai/tts.ts` to
  core. Verify the Expo build.
- **Phase 4 — Radio.** Implement `docs/RADIO-KHMER.md` on top of core's radio
  contracts (Worker D1 + a 📻 screen in each shell).

Each phase ships independently and is revertible. The apps keep working the whole
way.

### Wiring the workspace (Phase 2/3)

Root `package.json`: `"workspaces": ["packages/*"]` (PWA already at root) and add
`mobile` if not already independent. For Metro, add to `mobile/metro.config.js`:

```js
config.watchFolders = [path.resolve(__dirname, '../packages/core')]
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../node_modules'),
]
```

Both bundlers consume core's TS source directly (no build step) — it's typed and
tree-shakeable.

## Files in `packages/core`

| File | What it unifies |
|---|---|
| `types.ts` | domain rows, pack format, model status, dims/chunk constants |
| `text.ts` | `splitSentences`, `chunkText`, Khmer `normalizeNumbers`/`intToKhmer` |
| `prompt.ts` | `buildRagPrompt` / `buildRagMessages` (== the SFT prompt) |
| `engine.ts` | `Storage`/`Embedder`/`Generator`/`Tts` interfaces + shared `ask()` |
| `radio.ts` | outlet/news contracts + validation shared with the Worker |

Model *registries* stay platform-specific on purpose (ONNX repos for web, GGUF
repos for native) — same models, different packaging — so they live in each
shell, not core.
