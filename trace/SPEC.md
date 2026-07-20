# Trace Capsule — format specification (v2)

This is the open, keyless data format Trace uses. It is a plain JSON object; any
implementation that produces a byte-identical canonical form will compute the
same **id**, so capsules are portable across apps, offline, with no server and
no signing keys. This document is the source of truth — the reference
implementation is [`core/trace.ts`](./core/trace.ts).

Status: **stable** for `v: 2`. Additive fields may appear in future minor
revisions; the `id` always pins the exact contents present.

---

## 1. The capsule object

```jsonc
{
  "v": 2,
  "match": {
    "photos": [ /* PhotoSig objects — see §2 */ ],
    "boxText": "normalized label text (OCR or typed)"
  },
  "context": {
    "gps": { "lat": 11.55, "lng": 104.92, "acc": 12 },   // or null
    "capturedAt": "2026-07-19T08:30:00.000Z",             // device clock (a claim)
    "producer": "Sok's Farm",
    "product": "Kampot pepper, black, 100g",
    "note": "First harvest of the season.",
    "witness": "Kampot Pepper Co-op"                      // optional, "" if none
  },
  "event": { "type": "harvest", "step": 1 },              // optional (journey)
  "prev": null,                                            // optional (journey)
  "id": "9f2c…64 hex chars…"
}
```

- **`match`** — the *matchable* signals. Re-captured at verify time and scored.
- **`context`** — recorded once and *shown but never scored* (the item has moved,
  so a fresh reading is not comparable). These are self-reported claims;
  authenticity comes from `witness` people and the optional registry, not from
  the numbers.
- **`event` / `prev`** — present only when the capsule is one step of a journey
  chain (§4).
- **`id`** — the content hash (§3).

## 2. PhotoSig — the on-device photo signature

Each photo is reduced on-device to a small, dependency-free signature. No pixels
beyond a tiny thumbnail leave the device.

```jsonc
{
  "thumb": "data:image/jpeg;base64,…",  // ~160px preview, for side-by-side view
  "phash": "a1b2c3d4e5f6a7b8",          // 64-bit DCT perceptual hash, 16 hex
  "vec":   [ /* L2-normalized floats */ ], // colour-grid + gradient-orientation
  "color": [ /* 64 floats, sums to 1 */ ], // 4×4×4 RGB histogram
  "embed": [ /* optional L2-normalized floats */ ] // learned embedding (opt-in)
}
```

Working resolution is 32×32. `phash` is the top-left 8×8 low-frequency DCT block
(excluding DC) thresholded on its median. `vec` concatenates a spatial colour
grid with a gradient-orientation (texture/shape) histogram, L2-normalized so it
compares by cosine. `color` is a separate 64-bin normalized RGB histogram.

**`embed` (optional, learned)** — an L2-normalized embedding from a learned model
(the reference web layer injects a **MediaPipe Image Embedder**, MobileNetV3,
~4 MB, via a `MatcherAdapter`). It's opt-in ("better matching") because it needs a
model download, unlike the instant, zero-download classical path. **Additive and
backward-compatible:** the appearance score uses `embed` **only when both** the
origin and the fresh photo carry it (§5); otherwise it's ignored and matching
falls back to `vec` + `phash`, so any capsule stays verifiable by anyone — model or
not. Because `embed` is inside the signature, it's covered by the capsule `id`.

## 3. The id — keyless content addressing

```
id = SHA-256( JSON.stringify(capsule without the "id" key) )
```

The canonical form is `JSON.stringify` of the capsule with the `id` field
removed and **all other keys in the order shown above** (`v`, `match`,
`context`, `event`, `prev`). Because the thumbnails are inside `match.photos`,
the id also pins the images. Change any pixel or field and the id changes — this
is the entire tamper-evidence mechanism. There are **no keys to manage or lose**.

Verify recomputes the hash; if it ≠ `id`, the capsule was modified and the trust
score is capped (§5).

## 4. Journey chains (EPCIS-style)

A product's life is a chain of capsules. Each event capsule sets:

- `event.type` ∈ `harvest | process | pack | ship | receive | other`
- `event.step` — 1-based position in the journey
- `prev` — the **id of the previous event's capsule**, hash-linking the chain

Because each `prev` is a content hash, altering any earlier event breaks every
later link. A verifier loads all of a journey's capsules and checks that the
`prev` links form one unbroken hash chain.

## 5. Trust score

At verify, fresh matchable signals are compared to the capsule and combined into
one score in **0–100**:

| Signal | Key | Weight | Compared by |
|---|---|---|---|
| Product appearance | `visual` | 0.50 | cosine(`vec`) + Hamming(`phash`); if both sides have `embed`, cosine(`embed`) dominates |
| Colour / material | `color` | 0.25 | histogram similarity |
| Box / label text | `text` | 0.25 | fuzzy match **rate** of the two OCR reads |

- The weighted average is taken **over available signals only**; a **coverage
  penalty** (`0.7 + 0.3 · min(1, available/3)`) lowers the ceiling when fewer
  signals are present.
- A failed integrity check (§3) **caps the score at 15**.
- Bands: `strong ≥ 85`, `good ≥ 70`, `partial ≥ 45`, else `low`.

**Why OCR/STT needn't be "correct Khmer".** The label is read by the *same model*
at create and verify, so systematic quirks cancel — the two reads agree at a high
**rate** even if neither is perfect. `text` is that agreement rate, not a
ground-truth check. (See the note in [`GUIDE.md`](./GUIDE.md).)

## 6. Proof-strength tiers

A capsule's tier is derived purely from what it contains — no extra fields:

| Level | Condition |
|---|---|
| 1 · Basic | ≥ 1 photo |
| 2 · Good | ≥ 2 photos **and** non-empty `boxText` |
| 3 · Strong | level ≥ 2 **and** (`gps` **or** `witness`) |
| 4 · Full journey | level ≥ 3 **and** in a chain (`prev`, or `event.step > 1`) |

## 7. Optional online registry (HTTP)

Offline Create + Verify need none of this. The registry only *adds* trusted time
and double-use transparency. All endpoints are public and keyless; `:id` is the
64-hex capsule id.

| Method + path | Purpose |
|---|---|
| `POST /api/trace/register` | Record a **trusted first-seen** time. Idempotent. Body: `{id, producer?, product?, createdAt?}` |
| `GET /api/trace/check/:id` | Trusted first-seen + increment/return `verifyCount` (soft double-use hint) |
| `POST /api/trace/publish` | Store a capsule as a shareable provenance page (opt-in) |
| `GET /api/trace/page/:id` | Fetch a published page capsule |
| `POST /api/trace/attest` | Add a witness confirmation. Body: `{id, name, role?, note?}` |
| `GET /api/trace/attest/:id` | List a capsule's witness confirmations |
| `GET /api/trace/chain/:id` | Return a published journey (root → … → leaf) |

The reference server ([`worker/handlers.ts`](./worker/handlers.ts)) stores only
the origin summary + timestamps in D1 and published page capsules in R2 — **no
images and no personal data** beyond what a maker chose to publish.

---

Part of [iAny](https://iany.app) · Apache-2.0 · E-KHMER Technology Co., Ltd.
