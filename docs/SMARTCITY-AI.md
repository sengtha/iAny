# Smart-city AI in iAny — traffic first

Cities and towns run on questions that a phone camera can start to answer: *how
busy is this junction? how many vehicles pass here? where are the problems?* iAny's
smart-city track puts **on-device, offline** versions of these into anyone's hands —
no cameras to install, no cloud, no per-query cost.

Same fail-safe framing as the rest of iAny: these are **estimates and guidance**,
not certified counts or surveillance systems. Privacy first — video is processed on
the device and never uploaded.

---

## 🚦 Traffic — live vehicle + people counter (built)

[`/traffic`](https://iany.app/traffic) points the camera at a road and, **fully on
the device**, detects and counts what's in the frame — **people, motorbikes, cars,
buses, trucks, bicycles** — and shows a **congestion status** (light / moderate /
heavy) from how many vehicles are visible.

- **How:** MediaPipe **Object Detector** (EfficientDet-Lite0, COCO, ~4.6 MB,
  Apache-2.0) in VIDEO mode ([`src/lib/trafficDetector.ts`](../src/lib/trafficDetector.ts)),
  drawn as a live overlay ([`src/views/TrafficView.tsx`](../src/views/TrafficView.tsx)).
  The model is mirrored via `/models` and the shared vision WASM (same plumbing as
  Trace's embedder); the ~125 KB vision runtime + model load **once**, then it runs
  offline.
- **Privacy:** the camera stream never leaves the phone — nothing is uploaded.

### Honest limits
- **Tuk-tuk / remork isn't a COCO class** — a tuk-tuk is usually detected as `car`
  or `motorbike`. A **Cambodia-specific detector** would distinguish local vehicles
  (tuk-tuk, remork, cyclo) — that needs a street-scene dataset with bounding-box
  labels (heavier to annotate than the classification collectors), so it's the next
  step, not day one.
- It counts **what's in the frame now** (a live census), not vehicles that *pass* a
  line over time. True flow counting needs object **tracking** + a counting line
  (a clean future enhancement on the same detector).
- Small model + phone camera → approximate. Good for a quick read of how busy a spot
  is, not for official statistics.

---

## Roadmap (same detector / collector pattern)

- **Vehicle flow counting** — add lightweight tracking + a counting line to turn the
  live census into "N vehicles passed in 5 min."
- **Cambodia vehicle detector** — a `/street` collector for local street scenes →
  fine-tune a detector that knows tuk-tuk / remork / cyclo.
- **Parking / occupancy**, **crowd density** estimates for events/markets.
- **Ties to the environment track:** `/report` already maps civic issues; traffic
  hot-spots and litter maps compose into a simple community "what's happening where."

---

Part of [iAny](https://iany.app) · Apache-2.0 code · models Apache-2.0 (MediaPipe)
· Estimates, not certified counts · runs on-device · E-KHMER Technology Co., Ltd.
