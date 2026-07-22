# Changelog — Trace

All notable changes to Trace. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Trace uses the capsule format
version (`v`) as its compatibility anchor; see [`SPEC.md`](./SPEC.md).

## [Unreleased]

### Added
- **Optional "better matching" via a learned embedding.** New `MatcherAdapter`
  (`web/adapters.ts`) + a MediaPipe Image Embedder implementation
  (`web/mediapipeMatcher.ts`, MobileNetV3-small, ~4 MB, Apache-2.0). When switched
  on, each photo gets an L2-normalized learned embedding (`PhotoSig.embed`) for a
  sharper, more lighting/angle-robust appearance match. Opt-in and lazy (the ~125
  KB MediaPipe runtime + model load only on toggle); the zero-download classical
  descriptor stays the default. Backward-compatible: `embed` is scored only when
  **both** sides carry it, else matching falls back to `vec` + `phash`, so any
  capsule stays verifiable with or without the model. The capsule format is
  unchanged apart from the additive optional `embed` field (still pinned by `id`).

### Fixed
- **Proof-strength tier stuck on "Basic".** Level 2 · Good required **≥ 2
  photos**, and every higher tier is gated behind it — so a proof made the
  encouraged way (one photo, then a label, location, and witness) never left
  Basic no matter what trust info was added. Level 2 now needs **≥ 1 photo + a
  label**, so single-photo proofs climb Good → Strong → Full journey as signals
  are added. Extra photos still strengthen the appearance match (a separate
  axis). Updated `proofTier` (`core/trace.ts`), the Create hint, and SPEC §6 /
  GUIDE tables.

### Changed
- **Extracted into a self-contained `trace/` folder** (engine / web / worker +
  docs + license) so Trace can be run, embedded, or split out (`git subtree
  split --prefix=trace`) independently of iAny.
- Engine moved to `core/trace.ts`; UI to `web/` with OCR/STT decoupled behind
  optional `OcrAdapter`/`SttAdapter` interfaces injected by the host; registry
  backend moved to `worker/handlers.ts` with its own minimal `TraceEnv`.
- Added `README.md`, `SPEC.md` (open capsule-format spec), this changelog, and a
  local Apache-2.0 `LICENSE`. `GUIDE.md` is the former `docs/TRACE.md`.

## Capsule format v2

- **Better matching.** DCT perceptual hash (pHash) + spatial colour grid +
  gradient-orientation (texture) descriptor, compared by cosine + Hamming.
  Robust to brightness/hue change, ~8° rotation and ~12% crop while staying
  pure-JS, zero-model-download, and instant on cheap phones.
- **Guided multi-angle capture** (Front / Back-label / Close-up).
- **Consumer provenance page** (`/trace?p=<id>`) — publish a capsule as a
  shareable page with hero photo, story, farm-map link, witnesses, and a
  "Verify this product yourself" button.
- **Witness co-attestation** — a co-op/buyer adds a server-timestamped
  confirmation, turning a self-claim into a witnessed one.
- **Khmer voice story** at capture (on-device STT), matched by rate not
  correctness.
- **EPCIS-style journey chain** — each event is a content-addressed capsule
  whose `prev` hash-links the previous; the Journey tab verifies a chain offline
  and exports a due-diligence / compliance report (geolocation + chain of
  custody, EU EUDR-style).
- **Proof-strength tiers** (Basic → Good → Strong → Full journey) derived purely
  from a capsule's contents.

## Capsule format v1

- Keyless content-addressed capsule (id = SHA-256 of contents).
- dHash + colour + box-text matching; weighted trust score with coverage
  penalty; tamper cap.
- On-device Khmer OCR label scan; witness / GPS / story context.
- Optional keyless registry (trusted first-seen time + verify count).
- P2P transfer by file.
