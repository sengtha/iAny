# Changelog — Trace

All notable changes to Trace. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Trace uses the capsule format
version (`v`) as its compatibility anchor; see [`SPEC.md`](./SPEC.md).

## [Unreleased]

### Added — companion custody layer (`/custody`)
- **Signed custody events.** Delivery companies, warehouses and exporters add
  device-signed events (ECDSA-P256) to a product's chain, verified on ingest.
  A record with no company link is a valid *self-claim*; attaching a delegation
  later upgrades it with no re-signing. See [`COMPANION.md`](./COMPANION.md).
- **Staff ↔ company identity.** A company root key signs a **delegation** binding
  a staff key, name, role and expiry — X.509-style, bound by
  `delegation.staff === record.actor`, so a stolen delegation is useless on
  another person's events.
- **Two-party handoff.** Sender signs a *release* → short single-use code (QR) →
  receiver counter-signs a *receipt* over the same `capsule + from + nonce`.
  Cryptographically bound, so a receipt can't be reused for another item.
- **Proof of delivery.** The sender's screen polls until the receiver confirms
  and flips to "✓ Received by …", with an optional photo of the delivered item
  whose SHA-256 is bound into the receipt and re-matched against the origin
  capsule's signatures.
- **Auditable company ✓.** A badge is a **method + evidence**, never a bare tick:
  `domain` (the node fetches `/.well-known/trace-partner.txt` — no gatekeeper,
  anyone can re-check), `peer` (another company signs a vouch), or `registry`
  (an operator records an official record). Shown inline as `✓ Name · 🌐 domain`.
- **Staff badge.** The same delegation doubles as a free, offline-first employee
  ID: show it as a QR, and anyone can verify signature + expiry offline, plus
  revocation and company proofs when online. No blockchain, no per-credential cost.
- **Revocation.** A root-signed revocation published to the node; revoked staff
  drop to self-claimed on ingest. Verifiers say plainly when they could check the
  signature but not revocation.

### Added — Trace
- **One link shows the whole journey.** The public page walks the hash-linked
  chain and renders every production step with its custody events nested, plus a
  tamper-evident ✓/⚠ from re-hashing the chain. Any step's link resolves the
  full story.
- **Short, stable product links** (`/trace?p=kampot-pepper-2026-04`) — claim a
  slug once, re-point it as steps are added, so a printed label keeps working.
- **EUDR plot geolocation.** Walk a farm boundary corner by corner; area is
  computed live and a point-only plot is flagged the moment it crosses 4 ha.
  GeoJSON (Point/Polygon) is emitted in the due-diligence export with an honest
  `geolocation_sufficient` flag. GPS precision raised to 6 decimals (was 5,
  below the EUDR minimum). Covered by `npm run test:eudr`.
- **Offline P2P sharing.** Signed records share as a file through the OS share
  sheet (Bluetooth / Nearby / AirDrop / any app) and re-verify on import — the
  transport is untrusted by design. Public links also render as QR.
- **QR everywhere.** Capsule ids, public keys and delegations can be shown as a
  QR and scanned into any field that accepts them, rather than retyped.

### Fixed
- `/custody` tab bar overflowed the screen on phones once it reached five tabs.
- Internal vocabulary ("capsule id") replaced with "Product ID" in the companion UI.

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
