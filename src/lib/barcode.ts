/**
 * On-device barcode reading via the browser's native BarcodeDetector API — no
 * library, no upload, runs locally. Great on Android Chrome/WebView (iAny's main
 * platform). Not yet in iOS Safari or Firefox: `isBarcodeSupported()` lets callers
 * degrade gracefully (the /label reader still reads the ច.ប.ផ code via OCR).
 *
 * Pairs with src/lib/cbfCode.ts so /label reads a product's barcode + its
 * ច.ប.ផ registration code from a single photo.
 */

export interface BarcodeResult {
  /** The decoded payload, e.g. an EAN-13 "8850123456789". */
  value: string
  /** The symbology, e.g. "ean_13", "qr_code", "code_128". */
  format: string
}

// Retail + common 1D/2D symbologies. Product packages are usually EAN-13 / UPC.
const FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39',
  'itf', 'codabar', 'qr_code', 'data_matrix',
]

// BarcodeDetector isn't in the TS DOM lib yet — minimal shape + globalThis reach.
interface DetectorLike {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>
}
interface DetectorCtor {
  new (opts?: { formats?: string[] }): DetectorLike
}
function ctor(): DetectorCtor | undefined {
  return (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
}

/** True if this browser can scan barcodes on-device (Android Chrome: yes). */
export function isBarcodeSupported(): boolean {
  return typeof ctor() === 'function'
}

let detector: DetectorLike | null = null
function get(): DetectorLike | null {
  const C = ctor()
  if (!C) return null
  if (!detector) {
    try {
      detector = new C({ formats: FORMATS })
    } catch {
      try {
        detector = new C() // some builds reject the formats list — detect all
      } catch {
        return null
      }
    }
  }
  return detector
}

/** Decode the first barcode in a photo, or null (unsupported / none found). */
export async function detectBarcode(blob: Blob): Promise<BarcodeResult | null> {
  const d = get()
  if (!d) return null
  let bmp: ImageBitmap | null = null
  try {
    bmp = await createImageBitmap(blob)
    const codes = await d.detect(bmp)
    const hit = codes.find((c) => c.rawValue) ?? codes[0]
    return hit && hit.rawValue ? { value: hit.rawValue, format: hit.format } : null
  } catch {
    return null
  } finally {
    bmp?.close()
  }
}
