// Minimal ambient types for the zero-dependency `qrcode-generator` package
// (used to render the /custody handoff code as a scannable QR).
declare module 'qrcode-generator' {
  interface QRCode {
    addData(data: string, mode?: string): void
    make(): void
    getModuleCount(): number
    isDark(row: number, col: number): boolean
    createSvgTag(opts?: { cellSize?: number; margin?: number; scalable?: boolean }): string
    createDataURL(cellSize?: number, margin?: number): string
  }
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'
  function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QRCode
  export = qrcode
}
