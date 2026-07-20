# 🌳 Grove

**An open, decentralized network for verifiable garden & tree observations.**

Grove lets a phone measure a plant's carbon on-device and **sign** the result, so
anyone can verify and aggregate it — with **no central server** and no trust in one
operator. It's the measurement + trust layer for turning real gardens into a shared,
open environmental record: connect physical gardens to dashboards, community programs,
government encouragement, or a metaverse twin.

> The phone is the **source of truth**. Grove is estimates + provenance, **not**
> certified carbon credits.

Part of [iAny](https://iany.app), but self-contained and reusable on its own
(Apache-2.0), like [Trace](../trace).

## Why

Individual home gardens can't realistically sell certified carbon credits (tiny
scale, permanence, verification cost). But if **measuring** green action is cheap,
trustworthy, and decentralized, it becomes a substrate others can build on —
community programs, civic-participation incentives, a physical↔virtual twin. Grove
is that substrate.

## How it works

1. **Observe** — on the phone: identify the plant (species), measure it, estimate
   above-ground biomass → CO₂ (published allometry), attach a photo hash + GPS.
2. **Sign** — the device signs the content-addressed record (ECDSA P-256). The
   public key travels inside the record, so anyone can verify with no directory.
3. **Attest** — other devices can co-sign ("I visited, confirmed") — the
   decentralized trust layer.
4. **Federate** — any node verifies + stores + re-shares; any consumer (dashboard,
   [CamboVerse](https://github.com/camboversecenter/CamboVerse), a ministry) reads
   the verified records.

## Layout

```
grove/
  SPEC.md              ← the protocol (read this first)
  BRIDGE.md            ← the CamboVerse read contract (physical ↔ virtual)
  core/grove.ts        ← reference implementation: types, canonical hash,
                         device keys, sign/verify, carbon estimate, attestation, trust
  web/store.ts         ← on-device layer: device keypair, create/sign/store, publish
  worker/handlers.ts   ← the reference NODE: federated verify-on-ingest + public feeds
  worker/schema.sql    ← the node's two D1 tables
  README.md            ← you are here
  LICENSE              ← Apache-2.0
  CHANGELOG.md
```

The capture UI lives in the iAny app at [`/garden`](https://iany.app/garden)
(`src/views/GardenView.tsx`), and iany.app runs the reference node at
`/api/grove/*`. Both the node and the bridge are self-contained and reusable.

## Run a node

A node is trustless and replaceable — it re-verifies every signature on ingest and
stores the exact signed bytes so consumers can re-verify independently.

```ts
import { handleGrove } from './worker/handlers'
// in your Cloudflare Worker (env.DB is a D1Database):
if (url.pathname.startsWith('/api/grove/')) return handleGrove(url, request, env)
```

Apply `worker/schema.sql` once, then:

| Endpoint | |
|---|---|
| `POST /api/grove/submit` | one signed observation / array / bundle → verified + stored |
| `POST /api/grove/attest` | a signed co-signature → verified + stored |
| `GET  /api/grove/stats` | headline totals |
| `GET  /api/grove/feed?since=` | recent records (GPS coarsened ~1 km for privacy) |
| `GET  /api/grove/plot/:plot` | a garden's growth chain + per-record trust |
| `GET  /api/grove/observation/:id` | one record **with raw signed bytes** (re-verifiable) |

Consumers (dashboards, [CamboVerse](https://github.com/camboversecenter/CamboVerse))
read these — see [BRIDGE.md](./BRIDGE.md).

## Quick taste

```ts
import {
  generateDeviceKey, buildObservation, signObservation, verifyObservation,
} from './core/grove'

const key = await generateDeviceKey()
const unsigned = buildObservation({
  device: key.device, plot: 'home-garden-01', species: 'mango', count: 2,
  measure: { method: 'dbh_height', dbh_cm: 20, height_m: 8 },
  gps: { lat: 11.55, lng: 104.92, acc: 8 },
  observedAt: new Date().toISOString(), photoHash: '<sha256 of the photo>',
})
const obs = await signObservation(unsigned, key.keyPair)   // ~323 kg CO₂ estimate
const { ok } = await verifyObservation(obs)                // true — anyone, offline
```

## Honest scope

Signatures prove *who said*, not *what's true* — the oracle problem has no
pure-crypto fix (SPEC §6). Grove raises the cost of cheating (provenance + AI
plausibility + attestation) and always labels carbon an **estimate**. Certified
credits require an accredited methodology + verifier; Grove is the open layer beneath.

---

Apache-2.0 · part of [iAny](https://iany.app) · with the community, for the community.
