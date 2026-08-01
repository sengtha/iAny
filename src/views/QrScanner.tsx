import { useEffect, useRef, useState } from 'react'
import { detectBarcodeSource, isBarcodeSupported } from '../lib/barcode'

/**
 * Live on-device QR scanner — opens the rear camera and polls frames with the
 * native BarcodeDetector (no library, no upload). Calls `onScan` with the first
 * decoded value, then the caller closes it. Degrades gracefully where
 * BarcodeDetector is absent (iOS Safari / Firefox): shows `unsupportedText` so
 * the user falls back to typing the code.
 */
export function QrScanner({
  onScan,
  onClose,
  hint,
  unsupported,
  closeLabel,
}: {
  onScan: (value: string) => void
  onClose: () => void
  hint: string
  unsupported: string
  closeLabel: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const supported = isBarcodeSupported()

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    let scanning = true
    let timer = 0
    let stream: MediaStream | null = null

    const tick = async () => {
      if (cancelled || !scanning) return
      const v = videoRef.current
      if (v && v.readyState >= 2) {
        const hit = await detectBarcodeSource(v)
        if (hit?.value) {
          scanning = false
          onScan(hit.value)
          return
        }
      }
      timer = window.setTimeout(() => void tick(), 250)
    }

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const v = videoRef.current!
        v.srcObject = stream
        await v.play().catch(() => {})
        timer = window.setTimeout(() => void tick(), 300)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // onScan is captured once on purpose — the scanner sets up a single session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported])

  return (
    <div className="qr-scanner">
      {supported ? (
        <>
          <video ref={videoRef} className="qr-scanner-video" playsInline muted />
          <p className="voice-minor-note">{hint}</p>
        </>
      ) : (
        <p className="voice-error">{unsupported}</p>
      )}
      {error ? <p className="voice-error">{error}</p> : null}
      <button className="voice-ghost" onClick={onClose}>✕ {closeLabel}</button>
    </div>
  )
}
