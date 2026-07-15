# iAny Radio — real-time Khmer news radio, read by the on-device TTS

Turn iAny's offline Khmer voice into a **radio**: verified Cambodian media outlets
post short news as text; the app pulls the feed and **reads it aloud on-device**,
always naming the outlet. No server audio, no streaming cost — the phone
synthesizes the voice. Works on weak networks (text is tiny).

## What "real-time" means here

Not a server audio stream. The pipeline is:

```
outlet POSTs text ──► D1 (Cloudflare) ──► app polls /feed ──► on-device TTS ──► plays
     (seconds)                              (every ~20s)        (your voice)
```

"Live" = fast text propagation + immediate local synthesis. For news that's more
than enough, and it costs almost nothing to run.

## Ground rules (product decisions)

1. **Verified, well-known outlets only.** No open signup. An admin enables an
   outlet; each gets a secret API token (only its hash is stored).
2. **Attribution = responsibility.** Every item is stored with `outletName`, and
   the app **speaks and shows the outlet name first**: *"ព័ត៌មានពី [ឈ្មោះ]៖ …"*.
   Content responsibility is the outlet's, not iAny's. Back it with a one-page
   content agreement per outlet + a kill switch.
3. **Foreign words in Khmer script (enforced).** The TTS voice can't pronounce
   Latin text, so `POST /radio/news` **rejects** a body with more than a few
   Latin letters (`withinLatinBudget`, `RADIO_LIMITS.maxLatinLetters`). Outlets
   transliterate: Facebook → ហ្វេសប៊ុក. Numbers are fine as digits — the app
   speaks them in Khmer (`normalizeNumbers`).
4. **Sponsors labeled.** An optional short sponsor line is read/shown as
   *"ឧបត្ថម្ភដោយ… / Sponsored by…"* — never disguised as news.
5. **7-day TTL.** A daily cron purges items past `expiresAt` (createdAt + 7d).

## Backend — Cloudflare Worker + D1 (+ existing R2 mirror)

Contracts live in `@iany/core` (`radio.ts`), shared by app and Worker.

### D1 schema
```sql
CREATE TABLE outlets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  token_hash TEXT NOT NULL, verified INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE news (
  id TEXT PRIMARY KEY, outlet_id TEXT NOT NULL, outlet_name TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, sponsor TEXT,
  lang TEXT NOT NULL DEFAULT 'km',
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX idx_news_created ON news (created_at);
CREATE INDEX idx_news_expires ON news (expires_at);
```

### Endpoints
- `POST /radio/news` — `Authorization: Bearer <outlet token>`. Look up outlet by
  token hash; require `verified && active`. Validate lengths (`RADIO_LIMITS`) and
  `withinLatinBudget(body)`. Insert with `expires_at = now + 7d`. Return the id.
- `GET /radio/feed?since=<iso>` — return active items (`expires_at > now`,
  `created_at > since`), newest first, capped (e.g. 50), plus a `cursor` (max
  `created_at`) for the next poll. Public, read-only, cacheable a few seconds.
- **Cron** (`wrangler.jsonc` triggers, daily): `DELETE FROM news WHERE expires_at < ?`.

Auth is a hash compare (store `SHA-256(token)`), so a leaked DB can't post. Rotate
a token by replacing the hash.

## Client — a 📻 Radio screen (both shells, over core)

- **Queue player:** `GET /feed` → for each item build the spoken text
  `"ព័ត៌មានពី {outletName}។ {title}។ {body}"` (+ labeled sponsor) → feed the
  existing **streaming TTS** (sentence-by-sentence, prefetch next) → on empty,
  poll `/feed?since=cursor` and append.
- **Controls:** play/pause, skip, and the current headline + outlet shown on
  screen. Background audio (expo-av background mode / WebAudio) so it plays with
  the screen off.
- **Attribution is not optional** — the outlet name is always the first thing
  spoken and is always visible.

## MVP scope (build order)

1. D1 + `POST /news` (token auth + Latin validator) + `GET /feed` + cron cleanup.
2. Seed 1–2 **friendly, well-known outlets** with tokens + a signed agreement.
3. 📻 screen in one shell first (whichever you test on), reusing core TTS.
4. Pilot: listen to real news, judge the voice on names/numbers, add a per-item
   kill switch. Then scale outlets.

## Risks kept in view
- **Liability:** attribution + agreement + kill switch together — not attribution
  alone. As distributor you still want the agreement.
- **Moderation:** verified-only + kill switch for launch; add a review queue if a
  bad actor slips in.
- **Voice on proper nouns:** transliteration rule handles most; pilot before
  promoting. The voice keeps improving as training continues.
