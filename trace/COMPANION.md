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
| `POST /handoff/offer` | Sender publishes a signed **release**; node verifies it, holds it under a short code (1 h TTL). → `{ code, expiresAt }`. |
| `GET /handoff/:code` | Receiver reads the pending release (to verify + show the sender). 410 if expired. |
| `POST /handoff/:code/accept` | Receiver posts a signed **receipt**; node verifies the pair, writes two custody rows (release=`handoff`, receipt=`pickup`), consumes the code. → `{ ok, fromCompany, toCompany }`. |
| `POST /partner/revoke` | Company revokes a staff key (root-signed). After this, that staff's events drop to self-claimed on ingest. |
| `GET /partner/:key/revocations` | The staff keys a company has revoked (keys + times). |

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

## Two-party handoff (Phase 2)

Proof that a specific item changed hands between two identified parties. It's
asymmetric so **no key pre-exchange** is needed:

1. **Sender** (*Handoff → Give*): signs a **release** over `{capsule, from, at,
   gps, nonce}` and publishes it → gets a short **code** (e.g. `K7M4P2`).
2. Sender reads the code to the receiver (voice, or show it).
3. **Receiver** (*Handoff → Receive*): enters the code, sees + verifies the
   sender, then signs a **receipt** over `{capsule, from, to, at, gps, nonce}`.

Both cover the same `capsule + from + nonce`, so the pair is cryptographically
bound — a receipt can't be reused for another item, counterparty, or handoff.

**Proof of delivery (POD).** For last-mile delivery the *receiver* is often the
end customer, not enrolled staff — they just confirm receipt (self-claimed, no
key setup). The loop is closed for the **sender**: after publishing the code the
delivery screen polls `GET /handoff/:code/status` and flips to **"✓ Received by
[name] · [time]"** once the customer confirms. The signed receipt is the durable
proof; the row is kept 24 h so the driver can show the confirmation. The code is
single-use — a second accept returns 409.

**Photo of the item (optional).** At receipt the customer can snap the delivered
product. Its **SHA-256 is bound into the signed receipt** (`photoHash`), and if
the product has a published Trace page the app re-matches the photo against the
origin capsule's perceptual signatures and shows a score (reusing `computeTrust`).
That upgrades POD from "someone confirmed" to "the **right item** arrived" — the
timeline marks the receipt with `📷 N%`. The match score is client-computed
(advisory); the photo hash is the cryptographic commitment.
On completion the node writes the two custody rows, so the handoff shows up in
the same `/custody/:capsule` timeline (sender = `handoff`, receiver = `pickup`),
each attributed to its company via its delegation. Verify a completed pair
offline with `verifyHandoff(release, receipt, now)`.

The code is shown both as text and as a **QR** (encoding `/custody?h=<code>`).
The receiver can either scan it **in-app** (the *Receive* tab has a live camera
scanner using the native `BarcodeDetector`), or scan it with their phone's normal
camera — the link opens the console straight into *Receive* with the code
pre-filled. Where `BarcodeDetector` is absent (iOS Safari / Firefox) the scan
button hides and typing still works everywhere.

## Roster & revocation (Phase 3)

- **Roster** — the admin device remembers every staff member it enrolled
  (kept locally, so no server-side staff directory is needed) and shows them
  under *Company → Staff roster* with expiry + status.
- **Revocation** — tapping *Revoke* signs a `trace-revocation` with the company
  root key and posts it. From then on the node **refuses to attribute that
  staff's events to the company** — their custody events and handoffs drop to
  *self-claimed* on ingest (they can't be rejected retroactively, but they can
  no longer act *as the company*). This is the "fired driver" story, enforced
  server-side without waiting for the delegation's natural expiry. Only the
  company root can revoke its own staff.

That closes the companion feature: signed custody events, delegated staff
identity, two-party handoffs, QR transport, and roster + revocation — all
verifiable offline, no central authority.

## Setup

The custody + partner tables ship in the Trace schema — apply once:

```bash
npx wrangler d1 execute iany-radio --remote --file trace/worker/schema.sql
# (or the bundled iAny migration: worker/schema.sql)
```

Idempotent (`CREATE TABLE IF NOT EXISTS`). Until it's run, `/api/trace/custody`
returns the "trace registry not initialised" hint.
