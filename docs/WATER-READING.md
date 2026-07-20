# Water test strips on-device: a colorimetric reader (guide)

Goal: read a dipped water test strip from a phone photo → a **safety band**
(safe / caution / unsafe / unclear), **offline**, for rural water-quality checks
(esp. **arsenic** in Mekong-basin groundwater).

> **Read this first — water is NOT waste.** Waste is classification ("what object is
> this?") and trains from a labelled image set like TrashNet. A water strip is
> **colorimetry**: each coloured pad's shade maps to a concentration, read against
> the **reference chart printed on the kit**. There is **no big open dataset to train
> on, and you mostly don't need one** — the chart is the ground truth. The build is a
> classical CV pipeline plus (optionally) a tiny model that only *finds* the strip.

---

## 0. Why there's no "water TrashNet"

The literature is consistent: colorimetric strip reading = extract colour from each
pad → compare to reference swatches by colour distance (Euclidean / **CIEDE2000**) →
interpolate the value. Public data is small and study-specific (e.g. an ML pH reader
built on **787 samples** under controlled light). The closest well-studied analog is
**urine dipsticks** (same strip-of-pads structure) — see the refs in §7. So:

- **Don't** collect thousands of images to train a "water classifier."
- **Do** build the colorimetric pipeline (§2), and collect a **calibration/validation
  set** (§4) so the reader survives real phones and lighting.

---

## 1. The pipeline (what actually runs on the phone)

```
photo ─▶ 1. LOCALIZE strip + pads ─▶ 2. WHITE-BALANCE ─▶ 3. SAMPLE pad colour
      ─▶ 4. MATCH to the kit's chart ─▶ 5. SAFETY BAND (fail-safe)
```

1. **Localize** the strip and each coloured pad in the frame.
2. **White-balance** — the single biggest accuracy lever on phones (see §3).
3. **Sample** each pad's average colour (median of the centre region, in CIELAB).
4. **Match** to that kit's reference swatches by CIEDE2000 distance; interpolate
   between the two nearest swatches for a continuous estimate.
5. **Collapse to a band** — map the estimate to safe / caution / unsafe, biased
   **fail-safe** (see §8). Output the band, not a false-precise number.

Steps 2–5 are classical CV — no training. Only step 1 benefits from a small model,
and even that is optional (a coloured strip on a plain background segments well with
plain thresholding).

---

## 2. Reference charts = your ground truth

Each kit prints a colour→value legend (e.g. arsenic 0/10/25/50/100+ ppb; pH 4–9).
Encode those swatches **once per kit** as a small JSON table:

```json
{
  "kit": "arsenic-quick",
  "parameter": "arsenic",
  "unit": "ppb",
  "swatches": [
    { "value": 0,   "lab": [92, -2, 4] },
    { "value": 10,  "lab": [86, 3, 22] },
    { "value": 25,  "lab": [74, 10, 35] },
    { "value": 50,  "lab": [60, 18, 40] },
    { "value": 100, "lab": [46, 24, 38] }
  ],
  "bands": { "safe": "<10", "caution": "10-25", "unsafe": ">=25" }
}
```

The Lab values come from photographing the printed chart under good light (or the
manufacturer's spec). This tiny per-kit file is what turns a colour into a value —
**no model needed.**

---

## 3. White balance — the make-or-break step

Phone cameras auto-adjust colour, which destroys naive colorimetry. Two fixes, best
first:

- **Reference in the frame.** Ask the user to photograph the strip **next to the
  kit's own colour chart** (or a small neutral grey/white card). Normalize the whole
  image so the known reference matches its true colour, then read the pads. This makes
  the reading robust to lighting and is nearly free to ask for.
- **Grey-world / white-patch** fallback when no reference is present — weaker, and a
  reason to output "unclear" more readily.

This is why §4 asks people to include the chart in the shot.

---

## 4. What `/water` collects (calibration, not training labels)

The collector at [iany.app/water](https://iany.app/water) captures, per strip:

- the **photo** (encouraged: strip **beside its colour chart**, good light),
- **test** (arsenic / bacteria / pH / …) and **water source**,
- **safety band** — the actionable, required, fail-safe label,
- **kit / brand** and **chart reading** — *new fields* (the value the user matched,
  e.g. "10 ppb", "pH 6.5", "swatch 3"). These turn the coarse band into a real
  colour→value calibration point.

Stored in R2 (`water/<test>/<band>/…`) + D1 (`water_samples`). Use it to:

1. **Validate** the §2 chart tables against real phone photos across lighting.
2. **Calibrate** white-balance / distance thresholds per kit.
3. Later, **train a small learned reader** (a regressor on pad colour features →
   value) if classical matching isn't robust enough — features are cheap (RGB/HSV/Lab
   stats), so this needs hundreds, not thousands, of samples.

---

## 5. Optional: a strip-localization model

If plain segmentation isn't robust on cluttered backgrounds, train a tiny detector to
box the strip + pads (MediaPipe Model Maker EfficientDet-Lite, **float32 + GPU** — see
the delegate note in [`src/lib/trafficDetector.ts`](../src/lib/trafficDetector.ts)).
Bootstrap from the analog datasets in §7 or label a few hundred `/water` photos, then
wire it like the other MediaPipe models (mirror + loader). The colour reading (§2)
still runs classically on the located pads.

---

## 6. Deploy shape in iAny

Unlike the waste model, there's no single `.tflite` to ship first — the reader is a
CV module:

1. Add per-kit chart tables (§2) as bundled JSON.
2. Implement the localize → white-balance → match → band pipeline as a lib
   (`src/lib/waterReader.ts`), reusing the live-camera scaffold
   ([`src/views/LiveCapture.tsx`](../src/views/LiveCapture.tsx)) for a "point at the
   strip" UX.
3. (Optional) drop in the §5 localizer via the model mirror.

Everything runs on-device; nothing but the contributed photo+labels leaves the phone.

---

## 7. References + analog datasets (there's no canonical water set)

| Resource | What it is | Use |
|---|---|---|
| [SMARTurinalysis](https://github.com/mad-lab-fau/SMARTurinalysis) | Open urinalysis strip reader | Technique + strip/pad localization reference |
| [Automated urine dipstick colour classification](https://iopscience.iop.org/article/10.1088/1742-6596/978/1/012008/pdf) | Paper (Hue / Euclidean / CIEDE2000) | The colour-matching method |
| [Smartphone pH strips + ML (RSC)](https://pubs.rsc.org/en/content/articlelanding/2026/ay/d6ay00780e) | pH reader, 787-sample set | Feature design (RGB/HSV/Lab stats) |
| [Hybrid human–machine colorimetric water monitoring (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12000188/) | Reference-chart + inverse-distance interpolation | The §2/§3 approach |
| [AI for colorimetric detection — review](https://www.sciencedirect.com/science/article/pii/S2214158825000236) | Survey | Landscape + pitfalls |
| Roboflow Universe — search `class:strip` | Community strip-detection sets | Bootstrap the §5 localizer |

No large open **water**-strip corpus exists — this is a build-your-own
(reference-chart + small calibration set) problem, which is exactly what `/water`
is for.

---

## 8. Safety — the non-negotiable part

- **Arsenic and bacteria are life-safety.** A phone colorimetric read is approximate
  and lighting-sensitive. **Bias fail-safe:** when uncertain, say *"treat the water /
  get a lab test,"* and **never** show a confident "safe" on a borderline read. Prefer
  "unclear" over a wrong "safe."
- **The kit is the validated device; iAny only reads its colour.** This is guidance +
  education, not a certified measurement. Don't imply lab accuracy.
- **Cambodia focus:** groundwater arsenic in the Mekong basin is a genuine hazard, so
  arsenic strips matter — but field arsenic strips have coarse scales and known
  reliability caveats. Scope confidence accordingly and keep the disclaimer visible.

---

Part of [iAny](https://iany.app) · Apache-2.0 code · guidance, not a certified
measurement · runs on-device · see also
[docs/ENVIRONMENT-AI.md](./ENVIRONMENT-AI.md).
