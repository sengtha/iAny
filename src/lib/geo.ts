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

/**
 * Why a fix failed. 'denied' means the browser's permission prompt was
 * declined (or a prior denial — the browser won't prompt again; only the
 * user can undo that from the site's own permission settings).
 */
export type GeoError = 'denied' | 'unavailable' | 'timeout'

export interface GeoResult {
  point: GeoPoint | null
  error: GeoError | null
}

/** Request the current position once. This call itself is what triggers the
 *  browser's "Allow location access?" prompt on first use. */
export function getLocation(): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ point: null, error: 'unavailable' })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          point: {
            lat: +p.coords.latitude.toFixed(7),
            lng: +p.coords.longitude.toFixed(7),
            acc: Math.round(p.coords.accuracy),
          },
          error: null,
        }),
      (err) =>
        resolve({
          point: null,
          // code 1 = PERMISSION_DENIED, 3 = TIMEOUT (GeolocationPositionError).
          error: err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable',
        }),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  })
}
