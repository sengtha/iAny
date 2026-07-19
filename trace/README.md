# Trace — offline proof of origin, as a trust score

**Trace helps honest makers and farmers prove where their product came from with
just a phone — simple, no printing, offline, no keys — and gives a buyer a clear
trust score, not a fake yes/no.**

It is deliberately **not** an anti-counterfeit fortress. It makes an honest
producer's claim credible and cheap: capture many weak signals from the product
at origin, bundle them into a tamper-evident **capsule**, and at verify time
re-capture what's matchable and combine it into one **trust score (0–100)** with
a transparent breakdown.

Trace began as a use case inside [iAny](https://iany.app) but is a
self-contained project you can run, embed, or fork on its own. Everything it
needs lives in this folder.

- **What it can and cannot do, and the roadmap →** [`GUIDE.md`](./GUIDE.md)
- **The capsule format (open protocol) →** [`SPEC.md`](./SPEC.md)
- **License →** [`LICENSE`](./LICENSE) (Apache-2.0)

---

## Why keyless

A capsule's **id is the SHA-256 of its own contents**. Change any pixel or field
and the id changes — tamper-evidence with **no signing keys** for a farmer to
manage or lose. Create and Verify run **100% on-device, offline**. An optional
online registry only *adds* what connectivity can give: a trusted first-seen
timestamp and double-use transparency.

## Folder layout

```
trace/
  core/trace.ts        Zero-dependency engine: signatures, trust score, chains,
                       compliance report, registry client. No React, no iAny.
  web/
    TraceView.tsx      The full UI (Create / Verify / Journey / provenance page).
    TraceApp.tsx       Self-contained shell (header + EN/ខ្មែរ toggle).
    adapters.ts        Optional OCR/STT capability interfaces (see below).
    context.ts         React context that carries those capabilities.
  worker/
    handlers.ts        Optional registry backend (Cloudflare D1 + R2). Self-
                       contained: `serveTrace(url, request, env)`.
    schema.sql         D1 tables for the registry.
  GUIDE.md  SPEC.md  CHANGELOG.md  LICENSE
```

The engine (`core/trace.ts`) has **no dependencies** and knows nothing about
React, iAny, or any backend — it's the piece to reuse first.

## Embedding the UI

`TraceApp` is a drop-in React component. OCR (scan a label) and STT (speak a
story) are **optional capabilities** — Trace works fully without them (the user
just types). A host injects whatever engines it has, or none:

```tsx
import { TraceApp } from './trace/web/TraceApp'
import type { OcrAdapter, SttAdapter } from './trace/web/adapters'

// Both are optional — omit either to hide that affordance.
const ocr: OcrAdapter = { recognizeImage: (blob) => myOcr(blob) }

createRoot(el).render(<TraceApp ocr={ocr} /* stt={...} */ />)
```

iAny's host is [`../src/trace.tsx`](../src/trace.tsx): it injects iAny's
on-device Khmer OCR + STT. A standalone build can inject a WASM OCR, a cloud
API, or nothing at all.

> **Styling note (standalone finishing step).** The UI currently reuses iAny's
> stylesheet (`voice-*`, `contribute`, `ocr-drop` classes from
> `../src/styles.css`). A fully independent deployment should ship a small
> self-contained `trace.css`; extracting those rules is the one remaining step
> to make `web/` zero-coupling. The engine and worker are already standalone.

## The optional registry

Offline needs no backend. To enable trusted time + double-use + the shareable
provenance page, mount the worker handler and apply the schema:

```ts
import { serveTrace } from './trace/worker/handlers'   // env: { DB: D1, MODELS: R2 }
if (url.pathname.startsWith('/api/trace/')) return serveTrace(url, request, env)
```

```bash
npx wrangler d1 execute <your-db> --remote --file trace/worker/schema.sql
```

All endpoints are public and keyless; they store only the origin summary +
timestamps (and any capsule a maker chose to publish) — **no images, no personal
data**. Endpoint list is in [`SPEC.md §7`](./SPEC.md).

---

## Extracting Trace to its own repository

This folder is arranged to be lifted out cleanly. When the time comes:

```bash
git subtree split --prefix=trace -b trace-standalone
```

then push that branch to a new repo. The engine and worker come out
dependency-free; only `web/` carries the CSS coupling noted above.

---

Part of [iAny](https://iany.app) · Apache-2.0 · © 2026 E-KHMER Technology Co., Ltd.
