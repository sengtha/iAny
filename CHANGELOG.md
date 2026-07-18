# Changelog

All notable changes to iAny are documented here. This project is open source
under Apache-2.0, by [E-KHMER Technology Co., Ltd](https://www.e-khmer.com).

## v0.1.0 — first public release (2026-07-18)

The first open-source release of **iAny** — free, offline, on-device Khmer AI.
Everything runs on the user's device; nothing is required to leave it.

### App (PWA + mobile)
- **Offline RAG chat** — feed text, PDFs and photos; iAny chunks, embeds and
  indexes them in a real database in the browser (PGlite + pgvector) and answers
  questions in **Khmer or English** with cited sources, using an on-device LLM.
- **Hybrid Khmer/English retrieval** — HNSW vector search + full-text search
  fused with reciprocal rank fusion; Khmer-aware chunking.
- **Knowledge packs** — share a ready-made knowledge base as a single file, no
  internet needed.
- **Device-to-device model sharing** — export a downloaded model to a file and
  import it on another device (seed many phones from one download).
- **Encrypted cloud backup (beta)** — AES-GCM, key derived from a recovery code
  that never leaves the device; the server stores only ciphertext.
- **Khmer Radio** — verified outlets post news; the app reads it aloud with the
  on-device Khmer voice.
- **Mobile app** (Expo / React Native) — on-device SQLite hybrid retrieval,
  embeddings, `llama.rn` generation, and `whisper.rn` Khmer speech-to-text.

### Open Khmer AI
- **Speech-to-Text** — Khmer STT (Whisper fine-tune) on-device and in the app.
- **Text-to-Speech** — natural Khmer voices (female + male) that read aloud offline.
- **Khmer OCR** — read Khmer text from photos, on-device, with a confidence gate.
- **Khmer Braille** (`/braille`) — convert Khmer text to Unicode Braille and BRF
  files for embossers, following the Khmer Braille standard.

### Community data collectors (open datasets)
Standalone pages that build **open, CC-BY-SA-4.0 datasets** with opt-in credit,
so the models keep improving — with the community, for the community:
- **`/voice`** — read Khmer sentences aloud to train an open STT model.
- **`/scan`** — photograph + correct Khmer text to train an open OCR model.
- **`/sign`** — sign Khmer words to a camera; only **hand landmarks** are stored
  (never video), building an open **Khmer Sign Language** dataset.

### Web
- **Landing page** at `/` and the app at `/app`; standalone tools at `/voice`,
  `/scan`, `/sign`, `/braille`. Bilingual (Khmer/English), installable PWA.

### Open source & governance
- **Apache-2.0** license (code); models/datasets carry their own licenses.
- `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `COMMERCIAL.md` — the open-code / paid-service model, and a Deaf-community
  outreach kit for the sign-language effort.

**Mission:** build the best free Khmer speech, vision and accessibility AI, and
release the models open source — with the community, for the community.
