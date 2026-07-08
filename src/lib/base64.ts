/** Compact serialization for embeddings in knowledge packs. */

export function f32ToB64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function b64ToF32(b64: string): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

/** pgvector literal: '[0.1,0.2,...]' */
export function toVectorLiteral(arr: Float32Array | number[]): string {
  return `[${Array.from(arr).join(',')}]`
}

export function fromVectorLiteral(lit: string): Float32Array {
  return new Float32Array(JSON.parse(lit) as number[])
}
