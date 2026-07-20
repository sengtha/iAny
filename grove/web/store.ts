/**
 * Grove — on-device storage (the "source of truth" lives here). A device keypair
 * and the signed observations are kept locally (localStorage); nothing needs a
 * server. Portable: depends only on `../core/grove` + Web Crypto/localStorage.
 *
 * Key handling is intentionally simple for R&D: the private key (JWK) sits in
 * localStorage. A production host should offer secure storage + a backup/export
 * flow — losing the key means you can no longer *author* as that identity (past,
 * already-signed records stay valid forever).
 */
import {
  generateDeviceKey,
  buildObservation,
  signObservation,
  verifyObservation,
  estimateCarbon,
  sha256Hex,
  type GardenObservation,
  type ObservationInput,
  type Measure,
} from '../core/grove'

const DEVICE_KEY = 'grove.device.v1'
const OBS_KEY = 'grove.obs.v1'
const PLOTS_KEY = 'grove.plots.v1'

let cached: { device: string; privateKey: CryptoKey } | null = null

/** Load the device identity, generating + persisting it on first use. */
export async function getDevice(): Promise<{ device: string; privateKey: CryptoKey }> {
  if (cached) return cached
  const raw = localStorage.getItem(DEVICE_KEY)
  if (raw) {
    try {
      const { device, priv } = JSON.parse(raw) as { device: string; priv: JsonWebKey }
      const privateKey = await crypto.subtle.importKey(
        'jwk', priv, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'],
      )
      cached = { device, privateKey }
      return cached
    } catch {
      /* corrupt — regenerate below */
    }
  }
  const k = await generateDeviceKey()
  const priv = await crypto.subtle.exportKey('jwk', k.keyPair.privateKey)
  localStorage.setItem(DEVICE_KEY, JSON.stringify({ device: k.device, priv }))
  cached = { device: k.device, privateKey: k.keyPair.privateKey }
  return cached
}

export function loadObservations(): GardenObservation[] {
  try {
    return JSON.parse(localStorage.getItem(OBS_KEY) ?? '[]') as GardenObservation[]
  } catch {
    return []
  }
}

/** Create, sign, and store a new observation. Links to the plot's previous one. */
export async function createObservation(
  input: Omit<ObservationInput, 'device' | 'prev'>,
): Promise<GardenObservation> {
  const { device, privateKey } = await getDevice()
  const list = loadObservations()
  const prev = [...list].reverse().find((o) => o.plot === input.plot)?.id ?? null
  const unsigned = buildObservation({ ...input, device, prev })
  // Only privateKey is used for signing.
  const obs = await signObservation(unsigned, { privateKey } as CryptoKeyPair)
  list.push(obs)
  localStorage.setItem(OBS_KEY, JSON.stringify(list))
  addPlot(input.plot)
  return obs
}

export function loadPlots(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PLOTS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function addPlot(name: string): void {
  const p = loadPlots()
  if (name && !p.includes(name)) {
    p.push(name)
    localStorage.setItem(PLOTS_KEY, JSON.stringify(p))
  }
}

/** SHA-256 of the photo bytes — the provenance anchor tying a record to an image. */
export async function photoHashOf(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer())
}

/** Export the full signed bundle (observations) as portable JSON to send to any
 *  node / dashboard / CamboVerse. Each record carries its own proof. */
export function exportBundle(): string {
  return JSON.stringify({ v: 1, kind: 'grove-bundle', observations: loadObservations() }, null, 1)
}

export { verifyObservation, estimateCarbon }
export type { GardenObservation, Measure }
