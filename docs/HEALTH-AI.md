# Health AI in iAny — scope, safety, and how to use it responsibly

iAny is exploring on-device, offline health tools because in rural Cambodia a
phone is often the only "health worker" within reach. This document sets the
**boundaries** first, because health is not crops: a wrong answer can cost a life,
not a plant.

Read this before building, shipping, or relying on anything health-related here.

---

## What iAny is (and is not)

- **iAny is an open R&D platform and toolkit** — code, models, datasets, and
  building blocks, released open source for the community.
- **iAny is NOT a medical device, a diagnosis, or a clinical service.** Nothing
  here is certified, and none of it should be treated as medical advice.
- **How you use it is the regulation.** Like any foundation model or general AI
  system, the tool is neutral; responsibility attaches to the *deployment*. If you
  take these building blocks into a real product or a clinical setting, **you** own
  the compliance, validation, liability, and duty of care — not iAny. If E-KHMER
  ships a health service on top of this, E-KHMER protects that separately (its own
  review, disclaimers, and legal footing).
- **AI is not perfect — and neither are humans.** The goal is not a perfect oracle;
  it's a useful, honest tool that *knows and states its limits* and always routes
  people toward real care.

> **One-line stance:** *iAny provides open, offline health R&D building blocks for
> education and screening support — never diagnosis, never a substitute for a
> health worker. Production and clinical use are the deployer's responsibility.*

---

## The one rule that governs every health feature: fail safe

With crops, a wrong guess costs a plant. In health, the dangerous failure is
**false reassurance** — a wrong "you're fine" that makes someone skip care. So:

1. **Bias toward "get it checked."** When unsure — or even when confident-negative
   on anything serious — the safe output is *see a health worker*, not "all good."
2. **Screening / triage / education — never "diagnosis."** Language matters: "this
   *looks like* … — consider …," not "you have …."
3. **Always show confidence and always show the human path.** No bare yes/no on
   serious conditions; every result ends with a route to a clinician.
4. **Keep a human in the loop** wherever a decision has consequences.

---

## Tiers — what's safe to build now vs. what needs partners

### ✅ Safe to build in the open now (this repo)
- **Health education** (offline knowledge + Khmer TTS): maternal & child health,
  nutrition, ORS for diarrhoea, handwashing, vaccination reminders, first aid,
  danger-signs-to-seek-care. *Information, not diagnosis.* Highest reach, lowest
  risk. → the `/health` surface.
- **Rapid diagnostic test (RDT) result reading**: the *test* is the validated
  device; the model only reads the line pattern (positive / negative / invalid)
  from a photo. Reading, not diagnosing. → the `/health-test` collector, feeding a
  future MobileNetV3 reader (see `docs/VISION-MOBILENET.md`).
- **Tele-referral capture & medication/pill identification** (assist a human who
  decides).

### ⛔ Defer — needs clinical partners, validation, and a regulatory path
Diagnosis of disease from photos (skin, eye, etc.), anemia/malnutrition inference,
symptom-to-diagnosis chatbots. Valuable, but do these **only with** a health
authority / NGO / clinicians, with real validation and a regulatory plan. Do not
ship them solo as "diagnosis."

---

## Data, privacy, consent

Health data is far more sensitive than a crop photo. Rules for anything collected
here (e.g. `/health-test`):

- **Process on-device wherever possible; store the minimum.** For the RDT reader we
  collect only the *test-strip* photo + its result label — never faces, names, IDs,
  or documents.
- **Consent-first and anonymous** (a random device id, never a name), same as the
  other collectors. A real name is opt-in, only for dataset credits.
- **No personal health record.** iAny is not a place to store someone's medical
  history.

---

## Bias

A small model trained on limited data is biased. RDT brands, lighting, cameras,
and — for any body-image task — skin tone all matter. Spread collection across
provinces, brands, devices, and conditions, and report per-class/per-condition
performance, not just an average that hides the weak cases.

---

## Disclaimer template (for any health deployment)

Show this (localized) prominently wherever a health feature is used:

> **For information and screening support only — not a medical diagnosis.** This
> tool can be wrong. It does not replace a doctor, nurse, or health worker. For any
> health concern, or if you feel unwell, seek care from a qualified health worker.
> In an emergency, go to the nearest health facility.

---

## Roadmap

**Now (R&D, in this repo):**
- `/health` — offline Khmer health-education surface (curated topics + read-aloud +
  disclaimer). Content is starter/placeholder pending review by health
  professionals; structured so MoH/NGO experts can extend and verify it.
- `/health-test` — RDT-result-photo collector (test type + result), building an
  open dataset for an offline RDT reader.

**Next (needs data / partners):**
- Train the RDT reader from the collected dataset — step-by-step Kaggle guide in
  **[HEALTH-TEST-MODEL.md](./HEALTH-TEST-MODEL.md)** (Keras MobileNetV2 → ONNX →
  onnxruntime-web; bootstrap with synthetic strips, then fold in real `/health-test`
  photos). Deploy offline, speak the result in Khmer.
- Partner with MoH / NGOs to review the education content and to validate any
  screening tool before it's presented to the public as more than R&D.

**Explicitly not on the solo roadmap:** unsupervised disease diagnosis. That's a
partnership + regulatory track, not an open-repo feature.

---

Part of [iAny](https://iany.app) · Apache-2.0 code · content & datasets
CC-BY-SA-4.0 · Not a medical device · E-KHMER Technology Co., Ltd.
