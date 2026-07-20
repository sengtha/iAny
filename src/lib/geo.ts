/**
 * Tiny geolocation helper shared by the mapping collectors (/waste litter map,
 * /species sightings, /report civic issues). Location is always OPTIONAL and only
 * as precise as the device gives; it's what turns a photo into a map point.
 */

export interface GeoPoint {
  lat: number
  lng: number
  /** Accuracy radius in metres. */
  acc: number
}

/** Request the current position once. Resolves null if unavailable/denied. */
export function getLocation(): Promise<GeoPoint | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: +p.coords.latitude.toFixed(5),
          lng: +p.coords.longitude.toFixed(5),
          acc: Math.round(p.coords.accuracy),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  })
}
