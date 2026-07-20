# Grove fixtures — real signed sample data

Develop and test a Grove consumer (e.g. a [CamboVerse](https://github.com/camboversecenter/CamboVerse)
integration) against these **before** a live node exists. Every observation and
attestation here is genuinely device-signed and **verifies** with
[`../core/grove.ts`](../core/grove.ts) — this is not mock data, so your
verify-before-render path (see [../BRIDGE.md](../BRIDGE.md) §3) can be exercised
for real. Regenerate with `npx tsx grove/fixtures/generate.ts`.

The sample world: a gardener device with a **mango tree** in `home-garden-01`
observed twice a year apart (a growth chain via `prev`), plus **two coconut
palms** in `village-plot-07`; a neighbour device **confirms** the latest mango.

| File | Matches | What it is |
|---|---|---|
| `grove-bundle.json` | phone → **Export JSON** | Path A: an offline bundle of 3 signed observations. Ingest + verify each locally, no network. |
| `stats.json` | `GET /api/grove/stats` | Headline totals. |
| `feed.json` | `GET /api/grove/feed` | Newest-first records, **GPS coarsened to ~2 dp (~1 km)**, no raw bytes. |
| `observation.json` | `GET /api/grove/observation/:id` | One record **with raw signed bytes** + its attestation + `trust` (0–100). |
| `plot.json` | `GET /api/grove/plot/home-garden-01` | The mango's growth chain, oldest→newest, each scored. |

> `co2Kg` is an **estimate** (Chave 2014 allometry), never a certified credit —
> render it as "≈ estimated CO₂". See [../SPEC.md](../SPEC.md) §7.

## Verify one (any language ports the same 3 steps — SPEC §§4–5)

```ts
import { verifyObservation, trustScore } from '../core/grove'
import obsRes from './observation.json'

const { ok } = await verifyObservation(obsRes.observation) // true — offline, no server
if (ok) render(obsRes.observation, trustScore(obsRes.observation, obsRes.attestations))
```

Note: signatures/keys differ on each regeneration (ECDSA is randomized); the
committed files are one valid run. Timestamps are fixed for stable diffs.
