import type { GeoPoint } from './geo'

/** A straight row of evenly spaced trees, fixed by GPS at both ends. */
export interface RowLayout {
  id: string
  start: GeoPoint | null
  end: GeoPoint | null
  /** Ordered GPS waypoints. Two points describe a line; extra points describe bends. */
  waypoints?: GeoPoint[]
  spacingM: number
  nextTree: number
}

const EARTH_M_PER_DEG_LAT = 110540
const EARTH_M_PER_DEG_LNG_AT_EQUATOR = 111320

/** Ground distance in metres; flat-earth is exact enough over a few hundred metres. */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const dx = (b.lng - a.lng) * EARTH_M_PER_DEG_LNG_AT_EQUATOR * Math.cos(midLat)
  const dy = (b.lat - a.lat) * EARTH_M_PER_DEG_LAT
  return Math.hypot(dx, dy)
}

export function rowReady(row: RowLayout): row is RowLayout & { start: GeoPoint; end: GeoPoint } {
  const points = rowPoints(row)
  return points.length >= 2 && row.spacingM > 0 && rowLengthM(row) >= row.spacingM
}

export function rowPoints(row: RowLayout): GeoPoint[] {
  if (row.waypoints && row.waypoints.length >= 2) return row.waypoints
  return row.start && row.end ? [row.start, row.end] : []
}

export function rowLengthM(row: RowLayout): number {
  const points = rowPoints(row)
  let length = 0
  for (let i = 1; i < points.length; i++) length += distanceM(points[i - 1], points[i])
  return length
}

/** How many trees the GPS length implies at this spacing (both ends included). */
export function expectedTrees(row: RowLayout & { start: GeoPoint; end: GeoPoint }): number {
  return Math.round(rowLengthM(row) / row.spacingM) + 1
}

/**
 * How far the row's far end could sit to the side because of GPS error at the
 * two ends, and the matching direction error. Phones report roughly a 68%
 * radius; dividing by 1.5 approximates its one-axis (sideways) part.
 */
export function directionUncertainty(row: RowLayout & { start: GeoPoint; end: GeoPoint }): { sideM: number; deg: number } {
  const points = rowPoints(row)
  const sideM = Math.hypot(...points.map((point) => point.acc)) / 1.5
  return { sideM, deg: (Math.atan(sideM / rowLengthM(row)) * 180) / Math.PI }
}

/**
 * Where tree `n` (1 = the start tree) sits: (n − 1) × spacing along the line
 * from start toward end. Its accuracy is the worse of the two GPS ends, since
 * any error there carries into every computed position.
 */
export function rowTreePoint(row: RowLayout & { start: GeoPoint; end: GeoPoint }, n: number): GeoPoint {
  const points = rowPoints(row)
  let remaining = (n - 1) * row.spacingM
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const segment = distanceM(from, to)
    if (remaining <= segment || i === points.length - 1) {
      const f = segment === 0 ? 0 : Math.min(1, remaining / segment)
      return {
        lat: +(from.lat + f * (to.lat - from.lat)).toFixed(7),
        lng: +(from.lng + f * (to.lng - from.lng)).toFixed(7),
        acc: Math.max(...points.map((point) => point.acc)),
      }
    }
    remaining -= segment
  }
  return points[points.length - 1]
}
