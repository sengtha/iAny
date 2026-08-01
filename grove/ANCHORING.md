# Anchoring a Grove record on CSB — optional, and additive

**Grove's rule does not change: the phone is the source of truth.** A record is
valid because it verifies ([SPEC.md](./SPEC.md) §§4–5), not because a chain
vouches for it. An unanchored record is exactly as valid as an anchored one, and
every consumer — a dashboard, CamboVerse, a ministry — verifies both the same
way, offline, with no chain involved.

This document describes what anchoring adds, what it costs, and what it
deliberately refuses to claim. The reference implementation is
[`core/csb.ts`](./core/csb.ts) (dependency-free, Web Crypto + a vendored
Keccak-256). The chain side is
[CSB `docs/grove.md`](https://github.com/sengtha/CSB/blob/main/docs/grove.md).

---

## 1. Why bother

SPEC.md §6 states the limit plainly: a signature proves **who said something**,
never **whether it is true**, and no arrangement of cryptography fixes that. Two
consequences follow that a garden diary can live with and a payment cannot:

| | Grove alone | Anchored on CSB |
|---|---|---|
| **The date** | `observedAt` — the phone's own clock, set by the person making the claim | A block timestamp agreed by a validator set that has never met them |
| **The witness** | Attestations from device keys anybody can generate by the thousand | Confirmations from **licensed** verifiers — a commune agriculture officer, an agronomist, a cooperative — whose licence can be withdrawn |
| **The history** | A `prev` chain the holder maintains | A chain that cannot fork: a new anchor must extend the plot's current head |

If nobody is paying for the trees, none of this is needed and the extra step is
not worth taking. If somebody is — a sponsor releasing money against survival at
month 12 — then "the grower says the trees are fine" is not a thing anyone should
be asked to accept, and this is the cheapest available upgrade to it.

## 2. What is sent (and what is not)

Two 32-byte values, a count, and a short species tag. Nothing else.

```
observationId   the record's own SHA-256 content hash (SPEC.md §3)
plotId          keccak256(plot) — the plot STRING never goes on chain
prevId          the plot's current head on chain, or 0 for a first record
liveCount       living plants this record covers
species         a short tag, for a legible on-chain record
```

**No GPS, no photo, no photo hash, no device key, no plot name, no note.** A
farmer's fruit trees are worth stealing, and a permissioned national chain is
still readable by everyone on it. The hash reveals nothing and proves everything:
hand anyone the original signed record and they can recompute it.

## 3. Two different keys

| | Grove device identity | CSB account |
|---|---|---|
| Algorithm | ECDSA **P-256** | secp256k1 |
| Held by | the phone, never leaves it | the grower's CSB wallet |
| Signs | the observation | the anchoring transaction |
| Identity | a pseudonym, issued by nobody | KYC-attested by the Identity Authority |

They are not interchangeable, and `core/csb.ts` does not pretend otherwise: it
**builds the calldata and stops**. The grower's own wallet signs and sends it.
Gas on CSB is free, so anchoring costs a signature and nothing else.

**Whoever anchors first becomes the plot's steward** and is the only address that
can extend that plot's chain afterwards (they can appoint additional recorders —
a second phone, a cooperative's tablet). This is what stops a stranger appending
to your garden's history, which would otherwise be a way to be paid for your
trees.

## 4. Using it

```ts
import { anchorCall, chainHead, readPlotStatus } from './grove/core/csb'

// The plot may have been anchored from another device, and CSB refuses an anchor
// that would fork a plot's history — so ask the chain for the head, don't assume
// this phone's `prev`.
const head = await chainHead('https://csb.example', obs.plot)
const call = anchorCall({ ...obs, prev: head?.replace(/^0x/, '') ?? null })

// `call.data` is the calldata. Send it from a CSB wallet to GroveAnchor.
// Then, later:
const status = await readPlotStatus('https://csb.example', obs.plot)
status.verifiedCount   // living trees a LICENSED verifier confirmed — 0 means
                       // "nobody has confirmed the latest record", never "no trees"
```

`readPlotStatus` returns `{ available: false }` rather than throwing when the
endpoint is absent or unreachable. An offline-first app must never make a chain a
prerequisite for showing somebody their own garden.

The `/garden` page carries this as an optional panel: leave the CSB endpoint
blank and it does not exist.

## 5. What happens next on the chain

Anchoring alone is a notarised timestamp. The rest is opt-in and lives in CSB:

1. **A licensed verifier visits and confirms.** Only then does the record count
   as verified. Self-attestation is refused, unlicensed addresses are refused,
   and a single dispute withholds verification even against a confirmation.
2. **The grove can become a title** whose supply is the verified living-tree
   count — minted *and burned* against it, so the token follows the grove down
   when trees die.
3. **A sponsor can pledge for survival.** Money releases only against a record
   anchored after the milestone opened, confirmed by a licensed verifier, showing
   enough living trees — and the verifier is paid from the milestone for making
   the visit.

## 6. Honest scope, restated

Nothing in this path mints carbon, and nothing produces a credit. CSB records
**trees**, because a tree is a claim somebody can walk out and falsify. The
oracle problem is not solved and cannot be: a licensed officer can be lied to,
be lazy, or be paid off. What changes is that cheating now requires a licensed
professional to put their registration behind a false statement, on a record
with a timestamp they cannot backdate, for a payment the sponsor can see. That
is a much worse deal for a fraudster than a spreadsheet — which is the whole
claim, and the entire claim.

---

Part of [iAny](https://iany.app) · Apache-2.0 · estimates, not certified credits ·
the phone is the source of truth.
