# Security Policy

iAny runs AI on-device and also operates a hosted service (a Cloudflare Worker
with R2/D1 for model mirroring, encrypted backups, Radio, and the community
data collectors). We take security and user privacy seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately by one of:

- **GitHub Security Advisories** — use the repository's *Security* tab →
  *Report a vulnerability* (preferred; lets us collaborate on a fix privately).
- **Email** — sengtha@gmail.com with the subject line `iAny security`.

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected component (PWA, mobile app, Worker/API, a specific endpoint),
- any suggested remediation.

## What to expect

- We aim to acknowledge reports within **72 hours**.
- We'll work with you on a fix and coordinate a disclosure timeline.
- With your consent, we're happy to credit you once a fix ships.

## Scope

In scope: the iAny code in this repository and the hosted API
(`/api/*`, `/models/*`, `/radio/*`, backups). Especially interested in:

- authentication/authorization on admin endpoints (the `RADIO_ADMIN_TOKEN`
  guarded `/api/*/admin/*` routes),
- issues in the encrypted backup flow,
- anything that could expose a contributor's identity in the community
  datasets (voice / OCR / sign), which are designed to be anonymous,
- data validation on the public upload endpoints.

Out of scope: third-party model/dataset hosts (e.g. Hugging Face), and
denial-of-service via traffic volume.

## Handling secrets

All service secrets (admin tokens, storage keys) are configured as **Cloudflare
environment secrets** and are **never committed to the repository**. If you
believe a secret has been exposed, treat it as a vulnerability and report it
privately as above.
