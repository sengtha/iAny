# Grove — protocol specification (v1)

Grove is an **open, decentralized protocol for verifiable garden/tree
observations**. The user's phone is the source of truth: it measures a plant's
carbon on-device and **signs** the record with a device key. Any party — a startup
dashboard, a community, a metaverse, a ministry — can verify and aggregate records
**with no central server and no trust in one operator**.

This document is the source of truth. The reference implementation is
[`core/grove.ts`](./core/grove.ts) (dependency-free; runs identically in a browser
and Node via Web Crypto). Status: **draft v1** — additive fields may appear in minor
revisions; `id` always pins the exact contents present.

---

## 1. Roles

| Role | Does |
|---|---|
| **Device** (a phone) | Creates + signs observations. Holds a keypair. The source of truth. |
| **Attester** (another device) | Co-signs an observation it has independently checked. |
| **Node** (anyone) | Ingests, **verifies**, stores, and re-shares signed records. Federated — many independent nodes. |
| **Consumer** (dashboard / CamboVerse / gov) | Reads verified records and renders/aggregates. No special privilege. |

There is no central authority. A record is valid because it **verifies**, not
because a particular server vouches for it.

---

## 2. Identity

A **device identity** is an ECDSA **P-256** public key, encoded base64url of its raw
(uncompressed, 65-byte) point. That string is the `device` field and the device's
stable id. The matching private key never leaves the device.

- Verifiers need no directory: the public key travels **inside** every record.
- A device may hold several plots; a plot may be observed by several devices.

> Key backup/recovery is a host concern (the `web/` layer): losing the private key
> means losing the ability to *author as that identity* — past records stay valid.

---

## 3. The observation object

```jsonc
{
  "v": 1,
  "kind": "observation",
  "device": "<base64url P-256 pubkey>",     // WHO — the signer
  "plot": "home-garden-01",                 // stable id grouping a garden over time
  "species": "mango",                       // from /species ID or typed
  "count": 2,                               // identical plants this record covers
  "measure": { "method": "dbh_height", "dbh_cm": 20, "height_m": 8 },
  "biomassKg": 187.46,                      // estimate (total = per-plant × count)
  "co2Kg": 323.04,                          // estimate — NOT a certified credit
  "gps": { "lat": 11.55, "lng": 104.92, "acc": 8 },   // or null
  "observedAt": "2026-07-20T08:30:00.000Z", // device clock — a claim
  "photoHash": "<sha-256 hex of the photo>",// ties the record to a real image
  "prev": null,                             // previous observation id for this plot
  "note": "",
  "id": "<sha-256 hex of the canonical object>",
  "sig": "<base64url ECDSA signature over id>"
}
```

- **`id`** = `SHA-256(canonical(observation without id, sig))` — tamper-evidence.
- **`sig`** = the device's signature over the UTF-8 bytes of `id` — authenticity.
- **`prev`** hash-links a plot's observations into a growth chain over time.

### Canonicalization (critical for interop)

`canonical(x)` = JSON with **object keys sorted recursively**, no insignificant
whitespace. Any implementation producing byte-identical canonical bytes computes the
same `id` and verifies the same signature. Numbers that feed carbon (`biomassKg`,
`co2Kg`, measurements) are **rounded to 2 decimals** before hashing to avoid
floating-point drift across languages.

---

## 4. Carbon estimate

`co2Kg` is derived, not asserted. Reference method (Chave et al. 2014, pantropical):

```
AGB (kg) = 0.0673 · (ρ · D² · H)^0.976
carbon   = AGB · 0.47            (IPCC carbon fraction)
CO₂e     = carbon · 3.667        (44/12)
```

where `ρ` = wood density (g/cm³, species table + 0.6 default), `D` = DBH (cm),
`H` = height (m). Height may be estimated from DBH when unmeasured. The method is
**deliberately conservative** and **woody-plants-only** — herbaceous plants
(banana, papaya, vegetables) store negligible durable carbon and return ~0 rather
than being over-credited. A consumer may re-derive and reject records whose `co2Kg`
doesn't match the stated `measure` — the estimate is transparent, not trusted blindly.

---

## 5. Attestation (the decentralized trust layer)

Another device co-signs an observation it has checked:

```jsonc
{
  "v": 1, "kind": "attestation",
  "ref": "<observation id>",
  "device": "<attester pubkey>",
  "verdict": "confirm",            // or "dispute"
  "note": "", "at": "2026-07-21T00:00:00Z",
  "id": "<sha-256>", "sig": "<base64url>"
}
```

Attestations are verified the same way. A legible **trust score** (0–100) combines a
base for a valid self-signed record (+ GPS, photo, chain) with confirmations from
**distinct** devices (and penalties for disputes). It is a *signal*, not authority —
each consumer sets its own threshold.

---

## 6. Honest scope — the oracle problem

**Signatures prove *who said* something, never *whether it is true*.** Bridging
physical reality into a verifiable record (the "oracle problem") has **no pure-crypto
solution**, and anyone can generate keys and fake records (Sybil). Grove therefore
does **not** claim proof of truth. It raises the cost of cheating with layered,
probabilistic defenses — device signatures, photo provenance (`photoHash`, and Trace
capture), on-device AI plausibility, GPS/time coherence, dedup, and **community
attestation / reputation** — and it always labels carbon an **estimate**, never a
certified credit. Registry-grade certification requires an accredited methodology and
verifier; Grove is the cheap, open **measurement + trust substrate** underneath.

---

## 7. Federation & sync (minimal contract)

A node MUST:
1. **Verify** every record on ingest (`verifyObservation` / `verifyAttestation`);
   reject invalid ones.
2. Address records by `id` (content-addressed → portable, dedupable across nodes).
3. Re-share records unchanged (they carry their own proof).

Transport is deliberately unspecified — signed JSON over HTTP, a pull feed, a
gossip/relay, or a file — because a verified record needs no trusted channel. This is
what lets **any startup or community run a node/dashboard and interconnect**, and lets
CamboVerse read directly from a user's phone.

---

Part of [iAny](https://iany.app) · Apache-2.0 · estimates, not certified credits ·
the phone is the source of truth.
