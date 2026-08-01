import qrcode from 'qrcode-generator'

/**
 * Render text as a scannable QR code, returned as an inline SVG string (crisp at
 * any size, no canvas). Used to show the /custody handoff code as a QR the
 * receiver can scan with any phone camera. Zero runtime deps beyond the tiny
 * `qrcode-generator` encoder.
 */
export function qrSvg(text: string, cellSize = 5): string {
  const qr = qrcode(0, 'M') // auto version, medium error correction
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true })
}
