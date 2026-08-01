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
| `GET /partner/:key` | Resolve a company root key → `{ name, logo, region, verified, proofs[] }` — the proof list is how a reader audits the ✓. |
| `POST /partner/verify-domain` | `{company, domain}` → node fetches `https://<domain>/.well-known/trace-partner.txt` and confirms the key. No gatekeeper. |
| `POST /partner/vouch` | A signed `trace-vouch` from another company (self-vouch rejected). |
| `POST /partner/verify-registry` | Operator only (admin bearer): record an official registration + who checked it. |
| `POST /handoff/offer` | Sender publishes a signed **release**; node verifies it, holds it under a short code (1 h TTL). → `{ code, expiresAt }`. |
| `GET /handoff/:code` | Receiver reads the pending release (to verify + show the sender). 410 if expired. |
| `POST /handoff/:code/accept` | Receiver posts a signed **receipt**; node verifies the pair, writes two custody rows (release=`handoff`, receipt=`pickup`), consumes the code. → `{ ok, fromCompany, toCompany }`. |
| `POST /alias` | Claim a short, stable product slug → journey step (`/trace?p=kampot-pepper-2026-04`). First claim mints a token (hash stored); only the token holder can re-point it. 409 if taken. |
| `GET /alias/:slug` | Resolve a slug → its capsule id. |
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

## Who verifies a company — and where you can check

Registering only proves **key ownership**, not identity, so registration alone
never earns a ✓. A tick that just says "trust us" is unearned authority — the one
thing the rest of Trace avoids — so a badge is always a **method + evidence**,
stored in `trace_partner_proofs` and shown publicly. Three layered paths:

| Method | Who establishes it | What it proves | Re-checkable by |
|---|---|---|---|
| **domain** | **nobody** — the node fetches it | the same people who run `kampotpepper.com` control this key | **anyone**, independently |
| **peer** | another company (co-op / association) signs a vouch | that voucher stands behind this company | anyone (signature + who signed) |
| **registry** | an operator, after checking an official record | an official record (e.g. MoC no.) was seen | the reader, against the registry |

**Domain proof (recommended, no gatekeeper).** The company publishes its root key
at `https://<domain>/.well-known/trace-partner.txt`, then `POST /partner/verify-domain`
`{company, domain}` — the node fetches the file, confirms the key, records the
proof. Free, instant, and *anyone* can repeat the same fetch to check it.

**Peer vouch.** From the **voucher's** device: `POST /partner/vouch` with a
`trace-vouch` signed by their root key. Self-vouching is rejected. A reader judges
it by how much they trust the voucher, whose name is shown.

**Registry (operator).** `POST /partner/verify-registry` with the admin bearer
token and `{company, record, detail, verifier}` — records e.g. `MoC #12345` plus
who checked it. This is the only path that requires the node operator.

**Where to check:** every custody row shows the method inline (`✓ Name · 🌐
kampotpepper.com`), and `GET /api/trace/partner/<key>` returns the full proof list
— method, evidence, who verified, when. The badge is auditable, not a promise.

## Staff badge — a free employee ID, no blockchain

The delegation a company already signs *is* a verifiable credential, so the same
machinery works as a **staff ID** far beyond cargo: a delivery driver at a
customer's door, a field inspector, an NGO worker, a co-op member.

- **Show** (`/custody` → Identity): *Show my staff badge* renders the signed
  delegation as a QR, with the expiry.
- **Check** (`/custody` → Verify ID): anyone scans it — no account, no login —
  and `verifyBadge()` answers three questions in increasing cost:
  1. signed by the company root key, and not expired? — **offline, instant**
  2. has the company published a revocation for this staff key? — needs the node
  3. is the company itself verified, and by which method? — needs the node

Revocation is deliberately a **published list** (`GET /partner/:key/revocations`),
not a chain: the company posts a root-signed revocation and every verifier that
is online sees it immediately. A purely offline verifier can never know about a
revocation issued after its last sync — *no design fixes that, blockchain
included* — so the UI says plainly when it checked the signature but could not
check revocation. Short expiries bound that window.

Why this needs no blockchain: the question is "did this company say this?", which
a signature answers — not "who spent first?", which needs global consensus.
Skipping the chain means zero cost per credential, instant issuance, offline
verification of steps 1, and no public permanent ledger of who employs whom.

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

## EU readiness (EUDR today, DPP next)

**EUDR — EU Deforestation Regulation 2023/1115.** In scope for Cambodian pepper,
cashew, rubber and coffee. Large/medium operators must comply from **30 Dec 2026**,
SMEs from **30 Jun 2027**. It asks for the **production plot's geolocation**:

- a **point** for plots under 4 ha, a **polygon** of the perimeter at 4 ha and above,
- coordinates to **at least six decimals**,
- plus a chain of custody for the goods.

Trace covers the geolocation + custody half:

- `/trace` → *Farm plot for EU export* walks the boundary corner by corner
  (`PlotWalker`), showing the running area and warning the moment a point-only
  plot crosses 4 ha.
- `buildPlot` / `polygonAreaHa` / `plotGeoJson` (in `core/trace.ts`) compute the
  area and emit GeoJSON — a `Point` under 4 ha, a closed `Polygon` above.
  Verified by `npm run test:eudr`.
- GPS is stored at 6 decimals (it was 5 before — below the EUDR minimum).
- `complianceReport()` emits an `eudr` block with the GeoJSON FeatureCollection,
  the plot area, and an explicit **`geolocation_sufficient`** flag that is `false`
  when a ≥4 ha plot only has a point.

Honest scope: EUDR also requires **deforestation-free evidence** (land-cover
against the 31 Dec 2020 cut-off) and **legality of production**. Trace does not
assess either — it produces the geolocation and traceability trail an operator
files, not the risk assessment.

**DPP — Digital Product Passport (ESPR).** The CEN/CENELEC standards landed in
May 2026 (**EN 18219** identifiers, **EN 18220** data carriers) and the EU registry
opened **19 July 2026**; sectors phase in from batteries (Feb 2027) to
construction (2030). Its architecture — a static identifier in the carrier that
resolves to the maker's own data host — is already how Trace works (content
addressed id → public journey page), and ESPR Art. 10's "open, interoperable, no
vendor lock-in" is the design. Nothing is mandatory for Khmer food exports yet, so
this is the direction to track, not to build against.
