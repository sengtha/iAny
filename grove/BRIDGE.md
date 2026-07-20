# Grove ↔ CamboVerse — the bridge

**Connecting a physical garden to its virtual twin.**

A user's phone signs a real observation of a real plant (Grove — the source of
truth). CamboVerse ([camboversecenter/CamboVerse](https://github.com/camboversecenter/CamboVerse))
grows the matching virtual garden from those *verified* records. This document is
the **read contract** between them. It is intentionally small: CamboVerse needs no
special privilege, no API key, and no trust in iany.app — it reads the same public,
signed records anyone can, and it can **verify every one for itself**.

> Honest scope: `co2Kg` is an **estimate** from published allometry (Chave et al.
> 2014), never a certified carbon credit. The virtual world should render it as
> "estimated CO₂ captured", not a tradable asset. See [SPEC.md](./SPEC.md) §7.

> **Build against real data now.** [`fixtures/`](./fixtures) has genuinely
> device-signed sample records that verify with the reference verifier — an
> export bundle plus one example of every node response below. Develop your
> ingest + verify path against them before the node is live.

---

## 1. Two ways to connect

### A. Directly to the phone (no server)
The strongest link: CamboVerse reads the phone's exported bundle. On the phone,
`/garden` → **Export JSON** produces a `grove-bundle`:

```jsonc
{ "v": 1, "kind": "grove-bundle", "observations": [ /* signed observations */ ] }
```

A CamboVerse client (or a QR/deep-link handoff) ingests that bundle and **verifies
each record locally** with the reference verifier — no network needed. This is the
"user phone is the source of truth" path: the virtual garden is a direct function
of what the user signed on their own device.

### B. Through a node (aggregate / social)
For a shared world — neighbours' gardens on one map, a community total — CamboVerse
reads a **Grove node's** public feeds (below). iany.app runs the reference node, but
any node works; the node re-verifies on ingest and stores the exact signed bytes, so
CamboVerse can still re-verify independently. Federated: point at the node you trust.

---

## 2. Node read endpoints (public, read-only, CORS `*`)

Base: `https://iany.app/api/grove` (or any Grove node). No auth. JSON.

| Method + path | Returns |
|---|---|
| `GET /stats` | `{ observations, devices, plots, plants, co2Kg }` — headline totals. |
| `GET /feed?since=<iso>&limit=<n>` | `{ items: [obs…], cursor }` newest-first. GPS **coarsened to ~2 dp (~1 km)** for privacy; no raw bytes. Poll with `?since=cursor`. |
| `GET /plot/:plot` | `{ plot, totalCo2, records: [{ observation, attestations, trust }] }` — a garden's full growth chain, oldest→newest, each with a 0–100 trust score. |
| `GET /observation/:id` | `{ observation, attestations, trust }` — a single record **with its exact signed bytes** (`observation`), so CamboVerse can re-verify or federate it. |

`id` is the observation's content hash (64 hex). `:plot` is URL-encoded.

### Write (optional, for completeness)
| `POST /submit` | one signed observation, an array, or a `grove-bundle`. The node **re-verifies every signature** and stores only valid, new records. → `{ accepted, rejected, ids, errors }`. |
| `POST /attest` | one signed attestation (a co-signature). Re-verified. → `{ ok, id }`. |

CamboVerse is normally a **consumer** (reads); it writes only if it also acts as a
device (signs its own observations/attestations).

---

## 3. Verify before you render (required)

Do not trust the node — trust the math. Every observation carries its signer's
public key, so a consumer can verify with **no directory and no server**:

```ts
import { verifyObservation, trustScore } from 'grove/core/grove'

const { observation, attestations } = await (
  await fetch('https://iany.app/api/grove/observation/' + id)
).json()

const v = await verifyObservation(observation)   // { ok, idOk, sigOk }
if (!v.ok) return                                // drop it — tampered or forged
const trust = trustScore(observation, attestations)  // 0–100, transparent heuristic
```

`grove/core/grove.ts` is dependency-free and runs the same in a browser, Node, and
Workers (Web Crypto only). Port it to any language by re-implementing the canonical
JSON + SHA-256 + ECDSA-P256 verify described in [SPEC.md](./SPEC.md) §§4–5.

---

## 4. Suggested mapping (physical → virtual)

A minimal, non-prescriptive way to grow the twin from verified records:

| Grove field | CamboVerse |
|---|---|
| `plot` | a plot / parcel in the world — one virtual garden per plot id. |
| `species` | which model/plant to place (`mango` → a mango tree asset). |
| `count` | how many to place in that plot. |
| `measure` (`dbh_cm`, `height_m`) | the tree's **size/age stage** — grow the model as the real tree grows. |
| `prev` chain | an animation timeline: replay a plot's growth over its observations. |
| `co2Kg` | a rendered "≈ N kg CO₂ estimated" label — never a tradable token. |
| `trust` | a visual confidence cue (e.g. unverified = translucent, attested = solid). |
| `gps` | placement on the world map (use the coarsened feed value for public maps). |

Render **only** records where `verifyObservation(...).ok`. Show `trust` honestly so
players can tell a lone self-claim from a community-attested one.

---

## 5. Privacy & good citizenship

- The public `/feed` already coarsens GPS to ~1 km. For a public world map, prefer
  the feed's coordinates over a precise per-observation `gps`.
- A `device` key is a pseudonym, not a name. Don't attach real identities to it in
  the virtual world unless the user opted in elsewhere.
- Poll politely: `/feed?since=<last cursor>` and honour `cache-control`.

---

## 6. Status

Draft v1, tracking [SPEC.md](./SPEC.md). The read shape above is stable; additive
fields may appear in minor revisions (`id` always pins the exact contents present).
Questions / a CamboVerse integration PR are welcome.
