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
- **Delivery / warehouse / exporter companions →** [`COMPANION.md`](./COMPANION.md)
- **License →** [`LICENSE`](./LICENSE) (Apache-2.0)

## Two surfaces

| Page | Who it's for | What they do |
|---|---|---|
| **`/trace`** | maker · buyer | create a proof from a product; check one; view a product's full journey from one link |
| **`/custody`** | delivery · warehouse · exporter · anyone | add **signed** custody events to a product, co-sign handoffs, carry a staff badge, verify someone else's |

`/trace` is the entry point. The two are joined by the **capsule id**: a custody
event is signed *over the same id* the maker created, so both appear on one
public journey page. A maker hands a driver a QR (`/custody?c=<id>`) and the
console opens with the product already filled in.

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
                       EUDR plot geometry, compliance report, registry client.
                       No React, no iAny.
  core/companion.ts    Companion identity: ECDSA-P256 keys, staff delegations,
                       custody records, two-party handoffs, partner proofs,
                       revocations, vouches. Verifiable offline.
  core/*.test.ts       Regression suites — `npm test` (41 crypto + 11 geometry).
  web/
    TraceView.tsx        The full UI (Create / Verify / Journey / provenance page).
    TraceApp.tsx         Self-contained shell (header + EN/ខ្មែរ toggle).
    adapters.ts          Optional OCR / STT / Matcher capability interfaces (below).
    context.ts           React context that carries those capabilities.
    mediapipeMatcher.ts  Optional "better matching" via MediaPipe Image Embedder
                         (lazy-loaded; a host that doesn't want the dependency just
                         doesn't import this file).
    companion.ts         Companion web client: on-device key storage, register a
                         company, enroll staff, sign custody/handoffs, verify badges.
  worker/
    handlers.ts        Optional registry backend (Cloudflare D1 + R2). Self-
                       contained: `serveTrace(url, request, env)`.
    schema.sql         D1 tables for the registry + companion layer.
  GUIDE.md  SPEC.md  COMPANION.md  CHANGELOG.md  LICENSE
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
on-device Khmer OCR + STT, plus an optional **`MatcherAdapter`** — a MediaPipe
Image Embedder (`web/mediapipeMatcher.ts`) that powers an opt-in "better matching"
toggle (a learned, lighting/angle-robust appearance embedding). It's lazy: nothing
downloads until the user turns it on, and the zero-download classical match stays
the default, so a capsule is always verifiable with or without the model. A
standalone build can inject a WASM OCR, a cloud API, a different embedder, or
nothing at all.

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

The **companion layer** (custody events, partners, handoffs, staff badges) adds
signed records on top and uses the same mount + schema — see
[`COMPANION.md`](./COMPANION.md).

## EU readiness

- **EUDR** (Reg. 2023/1115) — `/trace` can map a farm plot by walking its
  boundary, stores coordinates at 6 decimals, and exports GeoJSON (Point under
  4 ha, Polygon at 4 ha+) inside the due-diligence report. It does **not** assess
  deforestation-free status or legality. Details in [`COMPANION.md`](./COMPANION.md).
- **DPP / ESPR** — Trace's shape (a static content-addressed id resolving to the
  maker's own page) already matches the Digital Product Passport model; nothing
  is mandatory for Khmer food exports yet, so it's tracked, not built against.

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
