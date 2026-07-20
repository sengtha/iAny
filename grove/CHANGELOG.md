# Grove — changelog

## v1 (draft) — initial

- Protocol spec ([SPEC.md](./SPEC.md)): signed, content-addressed garden observations;
  ECDSA-P256 device identity; conservative Chave-2014 carbon estimate; community
  attestation + a legible trust score; a minimal verify-on-ingest federation contract.
- Reference implementation ([core/grove.ts](./core/grove.ts)) — dependency-free, runs
  in browser + Node (Web Crypto). Self-tested: sign→verify roundtrip, tamper + forgery
  rejection, attestation, and carbon sanity.
- Honest scope: estimates + provenance, not certified carbon credits (SPEC §6).
