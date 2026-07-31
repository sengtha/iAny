# Trace — companion custody layer

**Let delivery companies, warehouses and exporters *join* a product's proof.**

Trace's product capsules are keyless (id = SHA-256 of contents). Supply-chain
actors need one thing keys *do* solve: a verifiable link from a real person to a
company. This layer adds device-**signed** custody events (ECDSA-P256, the same
crypto as Grove) on top of the existing journey, verified on ingest.

Everything is verifiable **offline** — no directory, no trust in iany.app.

## The identity hierarchy

```
Company root key ──registers──▶ trace_partners: name, logo, verified
      │ signs delegations
      ▼
Staff device key ──signs──▶ CustodyRecord on a product capsule
```

1. **Staff key** signs a `CustodyRecord` over a capsule id.
2. **Delegation** — the company root signs `{company, staff, staffName, role,
   issuedAt, expiresAt}` — proves a staff key acts for the company. Carried with
   the event, independent of it (X.509 style: `delegation.staff === record.actor`
   is the binding).
3. **Registry** resolves a company root key → name / logo / `verified`.

A record with **no** delegation is still authentic — it renders as *self-claimed*.
Attach a delegation later and the same event upgrades to the company, no re-sign.
This is the "open now, verify names later" hybrid.

## Endpoints (`/api/trace`, public, CORS `*`, JSON)

| Method + path | Purpose |
|---|---|
| `POST /custody` | Submit a signed `CustodyRecord`. Verify-on-ingest: bad signature → 400; a *broken/expired/unbound* delegation → 400 (rather than silently downgrading). → `{ ok, id, company, selfClaimed }`. |
| `GET /custody/:capsuleId` | The custody timeline for a capsule; each event resolved to its company (name/logo/verified). GPS coarsened to ~1 km. |
| `POST /partner` | Register/refresh a company root key → name/logo/region. **Signed by the root key** (only the owner can claim a name). `verified` is never set here. |
| `GET /partner/:key` | Resolve a company root key → `{ name, logo, region, verified }`. |

Crypto + types: [`core/companion.ts`](./core/companion.ts). Node verify-on-ingest:
[`worker/handlers.ts`](./worker/handlers.ts). Web client + key storage:
[`web/companion.ts`](./web/companion.ts). Console UI: iAny's `/custody` page.

## Roles & events

- **roles**: `carrier`, `warehouse`, `exporter`, `distributor`, `inspector`, `other`
- **events**: `pickup`, `in_transit`, `store`, `handoff`, `deliver`, `inspect`

## Flows (the `/custody` console)

- **Staff** → *My identity*: the device holds its own key; copy the public key to
  your admin. *Add event*: paste a capsule id, pick role + event, optional GPS,
  sign & submit (your delegation attaches automatically if you have one).
- **Admin** → *Company*: register the company (root key on **one** admin device),
  then *Enroll staff*: paste a staffer's public key → mint a delegation → send the
  text back to them to import.

## Verifying a partner (operator)

Self-registration sets `verified = 0`. After vetting a company, flip it:

```bash
npx wrangler d1 execute iany-radio --remote \
  --command "UPDATE trace_partners SET verified = 1 WHERE company_key = '<key>';"
```

A polished admin/roster dashboard and a two-party QR handoff (both parties
co-sign one capsule id) are the planned Phase 2/3.

## Setup

The custody + partner tables ship in the Trace schema — apply once:

```bash
npx wrangler d1 execute iany-radio --remote --file trace/worker/schema.sql
# (or the bundled iAny migration: worker/schema.sql)
```

Idempotent (`CREATE TABLE IF NOT EXISTS`). Until it's run, `/api/trace/custody`
returns the "trace registry not initialised" hint.
