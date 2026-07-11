# iAny — Vision

> Feed AI from anything. The more you feed it, the smarter it gets for *you* —
> and it runs entirely on your device.

This document is the north star. Every build decision should point at it. If a
feature doesn't serve the thesis, the flywheel, or the revenue model below, it
waits.

---

## What iAny is

A private, offline-first personal AI that you teach with your own documents and
daily life. It retrieves and reasons over *your* knowledge — on your device, at
zero cost per use — and answers in your language (starting with Khmer and
English).

## The thesis

The big platforms (Apple Intelligence, Gemini, Copilot) are adding AI
everywhere. iAny does **not** try to beat them at general intelligence. It wins
on the three things they structurally won't do well:

1. **Specialized** — deep on a narrow domain and language the giants ignore
   (Khmer first). This is the strongest part of the moat.
2. **Private** — grounded in data people *refuse* to put in the cloud (personal,
   medical, legal, financial). Offline is what makes that privacy real.
3. **Effortless to feed** — capturing a doc or a thought takes seconds.

"Offline" and "personalized" alone are not defensible — the giants can partly
match them. **Specialized + private + effortless** is the durable combination.

## The unfair advantage

On-device inference means **zero marginal cost per user**. Cloud AI apps must
charge to survive every query; iAny can give its core away **free forever** and
never go bankrupt from usage. Almost no competitor can do that.

## The core loop (this is the whole game)

```
effortless feed  →  useful answer  →  they come back daily
     →  a personal corpus they'd hate to lose  →  they pay to protect/extend it
```

Everything downstream — sync revenue, packs, any marketplace — depends on the
first two steps working. **The single most important question at every stage:**
once someone feeds it and asks in Khmer, is the answer good enough that they
come back tomorrow? If yes, there is a business. If no, nothing else matters.

Because of this, the **feed UX** (share-sheet, photo/OCR, voice, auto-capture)
is the highest-leverage thing to design — higher than any model work. Feeding
must be near-effortless or the flywheel never starts.

## Business model

**Free core, paid unlocks.** The on-device assistant is 100% free. Money comes
from optional unlocks:

- **Sync & backup (bankable revenue).** People pay to protect their "second
  brain" and use it across devices. This is the reliable, primary revenue —
  proven by iCloud / Google One.
- **Knowledge packs.** Users turn fed data into a curated, queryable artifact (a
  *result*, not raw data) and share or sell it. The tradeable unit is iAny's
  portable, embedded pack format — the container already exists.
- **DataFi (future, gated on regulation).** The long-term upside: a market for
  data-derived knowledge artifacts. Until regulation is ready, iAny stays out of
  brokering — trading is **peer-to-peer**, iAny is **not the broker**, and the
  monetization is simply **charging users to unlock the capability**. No
  tokenization / on-chain until it's legally and practically sound.

## Honest constraints (design around these, don't pretend they're solved)

- **Cold-start / retention is the #1 risk.** Daily-activity logging is
  habit-hard; the graveyard of "second brain" apps is huge. Effortless capture
  is the mitigation.
- **Small on-device models trail cloud models.** Compete where "good enough +
  offline + Khmer + private" beats "brilliant but cloud" — not on raw IQ.
- **Marketplaces are two-sided and hard to bootstrap.** Seed supply ourselves,
  concentrate on one vertical, don't build it before there are users.
- **Portable packs + P2P + no gatekeeper = copyable.** Freely copyable digital
  goods are hard to *sell*. Revisit access/licensing design when packs become a
  paid feature; accept the tension is real.
- **The marketplace is the one part that isn't free or offline.** It needs
  servers, payments, discovery, moderation — real cost, unlike the core.

## What we optimize for now

The technical roadmap serves the loop, in order:

1. **Fast, private, on-device** — native app (React Native + llama.rn) so good
   Khmer Gemma runs on real phones, including weak ones.
2. **Effortless feed** — the capture UX is the crux.
3. **Answer quality in Khmer** — grounded, professional, trustworthy.
4. Only then: sync, packs, and (much later) the regulated DataFi market.

## Non-goals (for now)

- Beating ChatGPT/Gemini at general intelligence.
- Building the marketplace, payments, or DataFi before the free core retains
  users.
- Blockchain / tokenization.
- Selling raw personal data — ever. Only user-created, derived artifacts.

---

*Platforms: desktop = PWA (works today), mobile = React Native (native, offline
Gemma). Shared: pinned embedding model, identical knowledge-pack format, so a
user's data moves freely between their computer and phone.*
