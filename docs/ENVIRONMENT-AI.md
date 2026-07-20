# Environment AI in iAny — water first

Rural environmental health in Cambodia often comes down to one question a family
can't easily answer: **is this water safe to drink?** Groundwater arsenic in the
Mekong basin, faecal contamination of ponds and shallow wells, and unsafe storage
cause real, preventable illness. iAny's job here is to put a **cheap, offline,
phone-based** check and clear guidance into people's hands.

Same pattern as the rest of iAny: **collect an open dataset → train a small
on-device model → run it offline → speak the result in Khmer**. Water is the
flagship; the vertical extends from there.

> **Scope & safety (shared with `docs/HEALTH-AI.md`):** iAny is an open R&D
> platform, not a certified environmental lab or a regulator. Readings are
> **guidance, not certified measurements**; they can be wrong. The **test kit is the
> validated device** — a model only *reads* it. Design **fail-safe**: when unsure,
> say "treat it / get it checked," never "safe." Production/official use is the
> deployer's responsibility.

---

## Water (building now)

### `/water` — water quality test-strip reader (collector first)
Colorimetric water test strips (arsenic, pH, chlorine, bacteria/H₂S, nitrate, …)
are cheap and widely used, but reading the colour against a chart is error-prone in
the field. So:

1. **Collect** ([`/water`](https://iany.app/water), built): photograph a dipped
   strip, tag the **test type**, the **safety band** (safe / caution / unsafe /
   unclear) read from the kit's chart, and the **water source** (tube well, pond,
   piped, rain, …). Reuses the image quality gate + dedup. Open dataset,
   CC-BY-SA-4.0, strip-photo-only privacy.
2. **Train** a MobileNetV3 reader (see `docs/VISION-MOBILENET.md`) that maps a strip
   photo → safety band, robust to phone/lighting variation (which is exactly why a
   *learned* reader beats a fixed colour chart).
3. **Deploy** offline via [`src/lib/imageClassifier.ts`](../src/lib/imageClassifier.ts);
   speak the result + advice in Khmer. "Point at the strip → unsafe → boil / find
   another source," with no lab and no signal.

**Why the band, not exact ppb:** kits and scales differ, and a family's actionable
question is *safe / treat-it / don't-drink*. Bands make the dataset consistent and
the output useful. Arsenic especially is a **fail-safe** case: err toward "unsafe."

### Water-safety education
Water knowledge lives on the [`/health`](https://iany.app/health) education surface
(safe water, arsenic awareness, treatment: boil / filter / chlorine / SODIS) —
read or listened to in Khmer, offline. Knowing *what to do* after a bad reading is
half the value.

---

## The rest of the environment vertical (roadmap)

Each is the same collect → train → deploy loop; only the dataset changes.

- **♻️ Waste / litter classification & mapping** — photograph + geotag rubbish and
  sort recyclables; citizen science for cleaner villages.
- **🐟 Species ID** — plants, birds, insects, fish for biodiversity monitoring
  (iNaturalist-style), and **mosquito-species ID** for dengue/malaria vector
  surveillance (bridges environment ↔ health).
- **🏙️ Citizen infrastructure reports** — pothole / broken light / illegal dumping
  → categorized + geotagged for the community or municipality (ties to Trace's
  content-addressed, GPS-stamped capsule idea).
- **🌫️ Air / water clarity proxies** — turbidity or haze estimates from photos
  (rough, guidance only).

Anchor everything to the fail-safe rule and to *action*: a reading is only useful
if it tells someone what to do next.

---

Part of [iAny](https://iany.app) · Apache-2.0 code · datasets & models
CC-BY-SA-4.0 · Not a certified measurement · E-KHMER Technology Co., Ltd.
