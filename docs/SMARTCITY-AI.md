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
the device**, detects and counts vehicles + people. It has **two modes**:

- **In frame** — how many **people, motorbikes, cars, buses, trucks, bicycles** are
  visible right now, plus a **congestion status** (light / moderate / heavy).
- **Count passing** — a **counting line** you can drag up/down; each vehicle is
  counted once as it **crosses** the line, giving a running "N passed" tally per
  type. This is true flow counting, not just a live census.

- **How:** MediaPipe **Object Detector** (EfficientDet-Lite0, COCO, ~4.6 MB,
  Apache-2.0) in VIDEO mode ([`src/lib/trafficDetector.ts`](../src/lib/trafficDetector.ts)),
  drawn as a live overlay ([`src/views/TrafficView.tsx`](../src/views/TrafficView.tsx)).
  Flow counting adds a tiny **centroid tracker + line-crossing counter**
  ([`src/lib/tracker.ts`](../src/lib/tracker.ts)) — pure JS on top of the detector,
  no extra model. The model is mirrored via `/models` and the shared vision WASM
  (same plumbing as Trace's embedder); the ~125 KB vision runtime + model load
  **once**, then it runs offline.
- **Privacy:** the camera stream never leaves the phone — nothing is uploaded.

### Honest limits
- **Tuk-tuk / remork isn't a COCO class** — a tuk-tuk is usually detected as `car`
  or `motorbike`. The [`/street`](#-street--cambodia-vehicle-collector-built) collector
  (below) gathers labelled local-vehicle photos so a Cambodia-aware classifier can fix
  this in a **detect-then-classify** pipeline.
- The tracker is deliberately simple (nearest-centroid + a horizontal line). It works
  well for steady one-direction flow; heavy crossing traffic or fast weaving can
  double-count or miss. Good for a rough passing count, not a certified survey.
- Small model + phone camera → approximate. Good for a quick read of how busy a spot
  is, not for official statistics.

---

## 🛺 Street vehicles — Cambodia vehicle collector (built)

[`/street`](https://iany.app/street) is a **community data collector**: photograph
**one vehicle**, tag its type — **tuk-tuk, remork, moto+trailer, motorbike, cyclo,
bicycle, car, pickup, van, bus, truck** — and it uploads the (photo, label) pair to
an open dataset. These are exactly the classes a generic COCO detector lacks.

- **Why:** a labelled Cambodia-vehicle dataset lets us train an offline **vehicle
  classifier** (MobileNet-class, tiny) and wire it into `/traffic` as a
  **detect-then-classify** step: the detector finds a vehicle box, the classifier
  says *tuk-tuk vs car vs remork* — so tuk-tuks finally get counted correctly.
- **Same pattern** as the other collectors: anonymous device id (`t-…`), opt-in
  credit, optional GPS, on-device blur + duplicate check before upload, R2 + D1
  storage. Files: [`src/assets/streetLabels.ts`](../src/assets/streetLabels.ts),
  [`src/lib/streetContribute.ts`](../src/lib/streetContribute.ts),
  [`src/views/ContributeStreetView.tsx`](../src/views/ContributeStreetView.tsx),
  worker `serveStreet` + `street_samples` table.
- **Privacy:** only the vehicle photo + label are sent — no faces or plates.

---

## Roadmap (same detector / collector pattern)

- **Detect-then-classify** — once `/street` has enough samples, train the vehicle
  classifier and run it on each `/traffic` detection box for tuk-tuk-accurate counts.
- **Cambodia vehicle detector** — with enough bounding-box labels, fine-tune a full
  detector that knows tuk-tuk / remork / cyclo natively.
- **Parking / occupancy**, **crowd density** estimates for events/markets.
- **Ties to the environment track:** `/report` already maps civic issues; traffic
  hot-spots and litter maps compose into a simple community "what's happening where."

---

Part of [iAny](https://iany.app) · Apache-2.0 code · models Apache-2.0 (MediaPipe)
· Estimates, not certified counts · runs on-device · E-KHMER Technology Co., Ltd.
