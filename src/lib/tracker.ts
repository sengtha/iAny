import type { Detection } from './trafficDetector'

/**
 * A tiny centroid tracker + line counter for /traffic "flow counting". It
 * associates detections across frames by nearest centroid, then counts a track
 * once when it CROSSES a horizontal counting line — turning the per-frame census
 * into "N vehicles passed". Pure JS, no model: the object detector already does
 * the hard part; this just links boxes over time. See docs/SMARTCITY-AI.md.
 */
interface Track {
  id: number
  label: string
  cx: number
  cy: number
  missed: number
  counted: boolean
}

export class LineCounter {
  private tracks: Track[] = []
  private nextId = 1
  /** Cumulative crossings per label. */
  counts: Record<string, number> = {}
  total = 0

  /** @param lineY counting line as a 0..1 fraction of frame height. */
  constructor(private lineY = 0.55) {}

  setLine(frac: number): void {
    this.lineY = Math.min(0.9, Math.max(0.1, frac))
  }
  getLine(): number {
    return this.lineY
  }
  reset(): void {
    this.tracks = []
    this.counts = {}
    this.total = 0
  }

  update(dets: Detection[], frameH: number): void {
    const linePx = this.lineY * frameH
    const n0 = this.tracks.length
    const matched = new Array(n0).fill(false)

    for (const d of dets) {
      const cx = d.x + d.w / 2
      const cy = d.y + d.h / 2
      // Nearest un-matched prior track within a size-scaled radius.
      let best = -1
      let bestDist = Infinity
      const maxDist = Math.max(d.w, d.h) * 1.5
      for (let i = 0; i < n0; i++) {
        if (matched[i]) continue
        const tr = this.tracks[i]!
        const dist = Math.hypot(tr.cx - cx, tr.cy - cy)
        if (dist < bestDist && dist < maxDist) {
          bestDist = dist
          best = i
        }
      }
      if (best >= 0) {
        matched[best] = true
        const tr = this.tracks[best]!
        const prevSide = tr.cy < linePx ? -1 : 1
        const side = cy < linePx ? -1 : 1
        tr.cx = cx
        tr.cy = cy
        tr.missed = 0
        tr.label = d.label
        if (!tr.counted && prevSide !== side) {
          tr.counted = true
          this.counts[tr.label] = (this.counts[tr.label] ?? 0) + 1
          this.total++
        }
      } else {
        this.tracks.push({ id: this.nextId++, label: d.label, cx, cy, missed: 0, counted: false })
      }
    }

    // Age out tracks that weren't seen this frame (tolerate brief occlusion).
    for (let i = 0; i < n0; i++) if (!matched[i]) this.tracks[i]!.missed++
    this.tracks = this.tracks.filter((tr) => tr.missed <= 8)
  }
}
