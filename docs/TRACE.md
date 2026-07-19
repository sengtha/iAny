# iAny Trace — offline proof of origin (trust score)

**Goal:** help *honest* makers and farmers prove their product's origin with just
a phone — **simple, no printing, offline, no keys** — and give a buyer a clear
**trust score**, not a fake yes/no. It is deliberately **not** an anti-counterfeit
fortress; it's a tool to make an honest producer's claim credible and cheap.

Route: **`/trace`** (a standalone page, like `/voice` and `/scan`). Runs on any
phone browser; no account.

---

## The core idea

> No single signal is treated as proof of truth. We capture **many weak signals**
> from the product at origin, bundle them into a tamper-evident **capsule**, and
> at verify time re-capture the matchable signals and combine them into **one
> trust score (0–100)** with a transparent breakdown.

- **Keyless.** A capsule's **ID is the SHA-256 of its own contents** (content
  addressing). Change any pixel or field and the ID changes — tamper-evidence
  with **no signing keys** for farmers to manage or lose.
- **Offline-first.** Create and Verify run 100% on-device. An optional online
  registry *adds* two things connectivity can give (trusted time, double-use).

---

## How it works

### 1. Create proof (100% offline)
Capture into a capsule:
- **Product photos** → on-device signature: **DCT perceptual hash + spatial
  colour grid + gradient-orientation (texture) descriptor**, compared by cosine +
  Hamming. Robust to lighting/rotation/crop. *Matchable.*
- **Box / label text** → typed, or **📷 Scan label** (on-device Khmer OCR).
  *Matchable.*
- **Witness** (co-op / buyer who vouches), **producer**, **product**, **GPS**,
  **note/story** (typed or **🎤 spoken in Khmer**, on-device STT), device time.
  *Context — shown, not scored.*

> **Why OCR/STT don't need to be "correct Khmer".** The label is read by the
> **same model** at create *and* verify, so its systematic quirks **cancel out** —
> two readings of the same box agree at a high **rate** even if neither is
> perfect Khmer. That's why the box-text signal is a fuzzy **match rate**, not an
> exact-string / "is-this-right-Khmer" check. Accuracy is measured as
> *agreement between the two readings*, not against a ground-truth transcription.
> (The spoken story is transcribed the same way — imperfect is fine; the maker
> can edit it.)
- Capsule **ID = SHA-256(contents)**. Saved as a small `.json`.

### 2. Transfer (P2P or online)
The capsule is just a file — send it **with the goods**: share sheet, Bluetooth/
Nearby, a chat app, or upload. No printing. (Reuses iAny's pack-file pattern.)

### 3. Verify proof (100% offline, or online)
- **Integrity:** re-hash the capsule; if it ≠ its ID, it was modified → flagged
  and the score is capped.
- **Match:** re-photograph the received product (and scan its label). Each fresh
  signal is compared to the capsule → per-signal similarity.
- **Trust score:** weighted over the **available** signals (appearance 50 % /
  colour 25 % / box-text 25 %), with a **coverage penalty** (fewer signals →
  lower ceiling). Result is banded: Strong / Good / Partial / Low.
- **Online add-on (optional):** cross-check the registry for a **trusted
  first-seen timestamp** and a **verify count** (a soft "copied many times" hint).

### 4. Share a provenance page (optional, online)
The maker can **publish** a capsule as a shareable **consumer page** at
`/trace?p=<id>`: hero photo, product, story, farm-map link, witnesses, and a
**"Verify this product yourself"** button. Buyers/co-ops can add a **witness
confirmation** on the page (server-timestamped) — turning a self-claim into a
witnessed one. This is the piece that earns a **price premium**: the buyer sees
the human story *and* can verify the physical product on the spot.

---

## What it CAN do

- ✅ **Create a tamper-evident origin record on any phone, fully offline**, no
  keys, no printing.
- ✅ **Measure consistency** between the received product and its documented
  origin, as a transparent 0–100 score with a per-signal breakdown.
- ✅ **Near per-item identity for unique, textured goods** (silk/krama, wood
  carving, ceramics, silverwork) — the visual signature is distinctive.
- ✅ **Detect tampering of the record** (content hash) offline.
- ✅ **Auto-read the label** with on-device Khmer OCR (less typing for farmers).
- ✅ **Record a witness + story + GPS** to make an honest claim credible.
- ✅ **Work with poor/no connectivity**; the online registry only *adds* value.

## What it CANNOT do (honest limits)

- ❌ **Prove authenticity of the origin claim.** Matching says "received ≈
  documented," not "the documented origin is true." A liar can photograph a nice
  farm. **Authenticity comes from witnesses**, not from matching.
- ❌ **Per-item verify fungible goods** (rice, pepper, sugar). Grains aren't
  re-identifiable — for bulk goods the score means *consistency* (same grade/
  colour/packaging), not "this exact item."
- ❌ **Prevent copying offline.** The same valid capsule can be attached to many
  items; **offline verification can't know it was reused.** Detecting reuse needs
  the **online registry** (verify count) — and even that is a hint, not proof.
- ❌ **Trust the capture time offline.** The device clock is a claim; a **trusted
  timestamp requires the online registry** (server first-seen).
- ❌ **Guarantee a match under bad conditions.** Very different lighting/angle/
  camera lowers the score; guide the framing and use multiple angles.

**One-line honest summary:** iAny Trace gives *"tamper-evident, offline-verifiable
evidence that a product matches its documented origin, backed by a witness"* —
**not** *"impossible to fake."*

---

## Privacy

- No account. The capsule holds only what the maker captured (product photos,
  label text, optional GPS/witness/story).
- The optional online registry stores **only** the capsule hash + a short origin
  summary (producer/product) + timestamps — **no images, no personal data**.
- GPS is optional and only as precise as the maker chooses.

---

## Deploying the online registry (optional)

Offline works with no setup. To enable the registry (trusted time + double-use):

```bash
npx wrangler d1 execute iany-radio --remote --file worker/schema.sql   # trace_capsules
npx wrangler deploy
```

Endpoints (public, keyless): `POST /api/trace/register`, `GET /api/trace/check/:id`.

---

## Roadmap

**v1 — offline trust score.** ✅ Keyless content-addressed capsule; dHash +
colour + box-text matching; weighted score with coverage penalty; tamper cap;
Khmer OCR label scan; witness/GPS/story context; optional registry (trusted time
+ verify count); P2P transfer by file.

**v2 (now) — better matching.** ✅
- **DCT perceptual hash + spatial-colour grid + gradient-orientation (texture)
  descriptor**, compared by cosine + Hamming. Verified robust: the same product
  under brightness/hue change, **8° rotation and 12% crop** still scores ~72
  ("good"), well clear of a different product (~35). Still **pure-JS, zero model
  download, instant** — keeps the works-on-any-cheap-phone-offline property.
- **Guided multi-angle capture** (Front / Back-label / Close-up prompts) to cut
  lighting/angle noise and make a match harder to fake.
- *Optional next:* a **learned on-device embedding** (MobileCLIP / DINO via
  onnxruntime-web) can drop into the `photoSignature()` swap-in for an even bigger
  jump — deferred by default because it adds a ~10–80 MB model download; the
  classical descriptor keeps Trace instant and download-free. A **grade/quality
  classifier** can be added as an extra scored signal the same way.

**v3 (now) — credibility & reach.** ✅
- **Consumer provenance page** (`/trace?p=<id>`): publish a capsule as a
  shareable page — hero photo, product, story, farm-map link, witnesses, and a
  "Verify this product yourself" button. The piece that earns a price premium.
- **Witness co-attestation:** any viewer (co-op/buyer) adds a server-timestamped
  confirmation on the page — self-claim → witnessed.
- **Khmer voice story** at capture ✅ — the maker just **talks** (on-device STT),
  and the transcript fills the story (editable). Low-literacy-friendly. Matched/
  read by **rate**, not correctness (see the OCR/STT note above).
- *Optional next:* auto-translate the story for export buyers; a built-in **QR**
  of the page link for packaging; a richer journey timeline.

**v4 — trust network & standards.**
- **EPCIS-style event chain** (harvest → process → ship → receive), each event a
  content-addressed capsule linked to the previous.
- **Anchoring** the registry's daily Merkle root to a public chain for
  independent verifiability (still no per-farmer keys).
- **Export compliance** exports (e.g. geolocation for EU due-diligence) so an
  exporter gets a compliance tool and the farmer gets a premium.
- Optional **NFC / object-fingerprint** tiers for makers who want stronger
  binding — same capsule format, stronger physical link.

**Non-goals (kept honest):** we do not claim to defeat determined counterfeiters,
and we won't market Trace as "unfakeable." The mission is to **help honest makers
be believed** — cheaply, offline, on a phone.

---

Part of [iAny](https://iany.app) · Apache-2.0 · E-KHMER Technology Co., Ltd.
Code: `src/lib/trace.ts` (engine), `src/views/TraceView.tsx` (UI),
`worker/index.ts` (registry).
