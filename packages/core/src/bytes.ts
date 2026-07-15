/**
 * base64 ⇄ bytes ⇄ Float32Array — the codec for knowledge-pack embeddings.
 * Pure JS (no btoa/Buffer — neither exists in Hermes), so the PWA and mobile
 * encode/decode pack vectors identically. Vectors are little-endian float32,
 * which is native on all target devices (x86/ARM), so a TypedArray view is a
 * zero-copy read.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  const n = bytes.length
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < n ? bytes[i + 1] : 0
    const b2 = i + 2 < n ? bytes[i + 2] : 0
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < n ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < n ? B64[b2 & 63] : '='
  }
  return out
}

const REV: Record<string, number> = {}
for (let i = 0; i < B64.length; i++) REV[B64[i]] = i

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const n = clean.length
  const outLen = Math.floor((n * 3) / 4)
  const out = new Uint8Array(outLen)
  let o = 0
  for (let i = 0; i < n; i += 4) {
    const c0 = REV[clean[i]] ?? 0
    const c1 = REV[clean[i + 1]] ?? 0
    const c2 = REV[clean[i + 2]] ?? 0
    const c3 = REV[clean[i + 3]] ?? 0
    if (o < outLen) out[o++] = (c0 << 2) | (c1 >> 4)
    if (o < outLen) out[o++] = ((c1 & 15) << 4) | (c2 >> 2)
    if (o < outLen) out[o++] = ((c2 & 3) << 6) | c3
  }
  return out
}

/** Float32Array -> base64 (little-endian bytes). */
export function float32ToBase64(v: Float32Array): string {
  return bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
}

/** base64 (little-endian float32 bytes) -> Float32Array. */
export function base64ToFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64)
  const usable = bytes.byteLength - (bytes.byteLength % 4)
  return new Float32Array(bytes.buffer.slice(0, usable))
}
