import { useState } from 'react'
import { qrSvg } from '../lib/qr'
import { isBarcodeSupported } from '../lib/barcode'
import { QrScanner } from './QrScanner'

/**
 * Shared QR helpers for the long, unreadable values this app passes between
 * phones — capsule ids (64 hex), public keys (~88 chars), delegations (JSON).
 * Nobody should retype those, so every such value can be **shown as a QR**, and
 * every field that accepts one can be **filled by scanning**.
 */

/** Show a value as a QR the other phone can scan (collapsed until asked for). */
export function QrShow({
  value, label, km, size = 5,
}: { value: string; label: string; km: boolean; size?: number }) {
  const [open, setOpen] = useState(false)
  if (!value) return null
  if (!open) {
    return (
      <button className="voice-ghost small" onClick={() => setOpen(true)}>
        ▦ {label}
      </button>
    )
  }
  // A long payload (a delegation is ~450 bytes → ~81 modules) needs a physically
  // bigger QR, or the modules get too small for a phone camera to resolve.
  const wide = value.length > 200
  return (
    <div className="qr-show">
      <div className={`handoff-qr ${wide ? 'lg' : ''}`}
        dangerouslySetInnerHTML={{ __html: qrSvg(value, size) }} />
      <div className="qr-show-actions">
        <button className="voice-ghost small" onClick={() => void navigator.clipboard?.writeText(value)}>
          ⧉ {km ? 'ចម្លង' : 'Copy'}
        </button>
        <button className="voice-ghost small" onClick={() => setOpen(false)}>
          ✕ {km ? 'បិទ' : 'Hide'}
        </button>
      </div>
    </div>
  )
}

/**
 * Pull the useful value out of a scan. A QR may carry a bare value or one of our
 * deep links (/custody?c=<capsule>, ?h=<code>, /trace?p=<id-or-slug>), so accept
 * all of them rather than making the user care which was printed.
 */
export function readScanned(value: string): string {
  const v = value.trim()
  try {
    const u = new URL(v)
    for (const k of ['c', 'h', 'p']) {
      const got = u.searchParams.get(k)
      if (got) return got
    }
  } catch { /* not a URL — fall through */ }
  return v
}

/** A 📷 button that opens the camera and hands back the scanned value. */
export function ScanButton({
  onScan, km, label,
}: { onScan: (value: string) => void; km: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  if (!isBarcodeSupported()) return null // iOS Safari / Firefox → typing stays the path
  if (!open) {
    return (
      <button className="voice-ghost small" onClick={() => setOpen(true)}>
        📷 {label ?? (km ? 'ស្កេន' : 'Scan')}
      </button>
    )
  }
  return (
    <QrScanner
      hint={km ? 'តម្រង់ QR ចូលក្នុងស៊ុម' : 'Point the camera at the QR code'}
      unsupported={km ? 'ឧបករណ៍នេះស្កេនមិនបាន' : 'This device can’t scan'}
      closeLabel={km ? 'បិទ' : 'Close'}
      onClose={() => setOpen(false)}
      onScan={(v) => { setOpen(false); onScan(readScanned(v)) }}
    />
  )
}
