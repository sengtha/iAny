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

export interface LocateOptions {
  /** Keep listening until a fix is at least this accurate (metres). Without it,
   *  the first fix is returned — on phones that is usually a coarse Wi-Fi/cell
   *  estimate, because the GPS chip needs several seconds to lock. */
  targetAcc?: number
  /** Stop waiting after this long and return the best fix seen. */
  maxWaitMs?: number
  /** Called each time a more accurate fix arrives while waiting. */
  onProgress?: (point: GeoPoint) => void
  /** Aborting stops waiting and returns the best fix seen so far. */
  signal?: AbortSignal
}

function toPoint(p: GeolocationPosition): GeoPoint {
  return {
    lat: +p.coords.latitude.toFixed(7),
    lng: +p.coords.longitude.toFixed(7),
    acc: Math.round(p.coords.accuracy),
  }
}

// code 1 = PERMISSION_DENIED, 3 = TIMEOUT (GeolocationPositionError).
function toGeoError(err: GeolocationPositionError): GeoError {
  return err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'
}

/** Request the current position. This call itself is what triggers the
 *  browser's "Allow location access?" prompt on first use. */
export function getLocation(opts: LocateOptions = {}): Promise<GeoResult> {
  const { targetAcc, maxWaitMs = 8000, onProgress, signal } = opts
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ point: null, error: 'unavailable' })
      return
    }
    const geo = navigator.geolocation
    if (targetAcc === undefined) {
      geo.getCurrentPosition(
        (p) => resolve({ point: toPoint(p), error: null }),
        (err) => resolve({ point: null, error: toGeoError(err) }),
        { enableHighAccuracy: true, timeout: maxWaitMs },
      )
      return
    }

    let best: GeoPoint | null = null
    let lastError: GeoError | null = null
    let done = false
    let watchId = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (done) return
      done = true
      geo.clearWatch(watchId)
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve(best ? { point: best, error: null } : { point: null, error: lastError ?? 'timeout' })
    }
    watchId = geo.watchPosition(
      (p) => {
        const point = toPoint(p)
        if (!best || point.acc < best.acc) {
          best = point
          onProgress?.(point)
        }
        if (point.acc <= targetAcc) finish()
      },
      (err) => {
        lastError = toGeoError(err)
        if (lastError === 'denied') finish()
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    )
    timer = setTimeout(finish, maxWaitMs)
    if (signal?.aborted) finish()
    else signal?.addEventListener('abort', finish)
  })
}
