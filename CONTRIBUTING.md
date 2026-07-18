# Contributing to iAny

Thank you for helping build free, offline, on-device Khmer AI — **with the
community, for the community.** Contributions of all kinds are welcome: code,
Khmer language expertise, model training, dataset contributions, documentation,
and translations.

## Ways to contribute

- **Code** — fix bugs, improve the PWA / mobile app / Worker, add features.
- **Khmer language** — improve chunking, prompts, OCR/STT/TTS quality, i18n
  strings (`src/i18n/`), or the voice/sign prompt sets.
- **Data** — contribute to the open Khmer datasets via the community collectors
  (`/voice`, `/scan`, `/sign`). See `docs/VOICE-COLLECTION.md`,
  `docs/OCR-COLLECTION.md`, `docs/SIGN-COLLECTION.md`.
- **Models** — help train or evaluate the open Khmer STT / TTS / OCR / sign
  models (see the `docs/RUNPOD-*.md` guides).
- **Docs & design** — clearer guides, tutorials, accessibility improvements.

## Getting started

```bash
npm install
npm run dev        # PWA at http://localhost:5173
npm run typecheck  # tsc, must pass
npm run build      # production build, must succeed
```

The mobile app lives in `mobile/` (Expo); the shared logic is in
`packages/core` (consumed as TypeScript source by both apps). The Cloudflare
Worker backend is in `worker/`.

## Pull request checklist

- `npm run typecheck` passes and `npm run build` succeeds.
- Keep changes focused; match the surrounding code style (comment density,
  naming, idioms). No new formatter/lint churn in unrelated files.
- For Khmer-facing text, keep pure Khmer script and, where relevant, provide
  both `en` and `km` i18n strings.
- Update the relevant `docs/` when behavior changes.
- Describe **what** changed and **why** in the PR description.

## Licensing of contributions

By submitting a contribution, you agree that it is licensed under the project's
**Apache License 2.0** (see `LICENSE`), consistent with Section 5 of that
license. Don't submit code, models, or data you don't have the right to share.

**Data & models** you contribute for the open datasets are released under the
dataset's stated terms (**CC-BY-SA-4.0** for the community collectors), with
opt-in credit — not Apache-2.0. Only contribute recordings, photos, or signs you
have the right to share, per each collector's consent terms.

## Language & conduct

Discussion can be in Khmer or English. Please read and follow our
[Code of Conduct](CODE_OF_CONDUCT.md). Be especially respectful when working on
features for and with the Deaf community and other communities iAny serves.

## Security

Please do **not** open public issues for security problems — see
[SECURITY.md](SECURITY.md) for private reporting.
