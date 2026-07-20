# Grove — changelog

## v1 (draft) — initial

- Protocol spec ([SPEC.md](./SPEC.md)): signed, content-addressed garden observations;
  ECDSA-P256 device identity; conservative Chave-2014 carbon estimate; community
  attestation + a legible trust score; a minimal verify-on-ingest federation contract.
- Reference implementation ([core/grove.ts](./core/grove.ts)) — dependency-free, runs
  in browser + Node (Web Crypto). Self-tested: sign→verify roundtrip, tamper + forgery
  rejection, attestation, and carbon sanity.
- Honest scope: estimates + provenance, not certified carbon credits (SPEC §6).
- On-device layer ([web/store.ts](./web/store.ts)) — device keypair (persisted),
  create/sign/store observations locally, export bundle, and `publish()` to a node.
- Reference **node** ([worker/handlers.ts](./worker/handlers.ts)) — federated
  verify-on-ingest (re-verifies every signature; stores raw signed bytes for
  re-verification/federation) + public read-only feeds (`stats`, `feed` with GPS
  coarsened ~1 km, `plot/:plot` growth chain, `observation/:id`). Runs on iany.app
  at `/api/grove/*`; self-contained for any Cloudflare Worker + D1.
- Capture UI in the iAny app at `/garden` (measure → estimate → sign → publish).
- CamboVerse bridge ([BRIDGE.md](./BRIDGE.md)) — the read contract for growing a
  virtual garden from verified physical records (verify-before-render, field mapping).
