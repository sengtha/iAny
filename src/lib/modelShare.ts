/**
 * Device-to-device model sharing without internet.
 *
 * Transformers.js keeps downloaded weights in the Cache API
 * ('transformers-cache'). Export bundles a model's cached files into one
 * binary file the user can move via Quick Share / USB / SD card; import
 * writes them back on the receiving device, so the model is ready with
 * zero download.
 *
 * Bundle layout: "IANYMDL1" magic · uint32-LE header length · header JSON
 * { format, model, files: [{ path, size, contentType }] } · concatenated
 * file bodies in header order. Bodies are sliced lazily from Blob/File, so
 * neither export nor import loads whole models into memory.
 */

import { MODEL_MIN_COMPLETE_BYTES } from '../types'

const CACHE_NAME = 'transformers-cache'
const MAGIC = 'IANYMDL1'

export interface ModelBundleInfo {
  files: number
  bytes: number
}

interface BundleHeader {
  format: 'iany-models/1'
  model: string
  files: { path: string; size: number; contentType: string }[]
}

/** Canonical path '{model-id}/{file}' (resolve segment stripped), so
 *  bundles survive moving between hosts (mirror, HF direct, self-hosted). */
function canonicalPath(url: string, modelId: string): string | null {
  const idx = url.indexOf(`${modelId}/`)
  if (idx === -1) return null
  return url.slice(idx).replace(/\/resolve\/[^/]+\//, '/')
}

async function matchingRequests(modelId: string): Promise<Request[]> {
  if (!('caches' in self)) return []
  const cache = await caches.open(CACHE_NAME)
  return (await cache.keys()).filter((req) => req.url.includes(`${modelId}/`))
}

/** Are the model's weights actually on disk? Requires the cached bytes to
 *  clear the per-model completeness threshold — config/tokenizer files or
 *  an interrupted weight download must not count as 'Downloaded'. */
export async function hasModelWeightsCached(modelId: string): Promise<boolean> {
  const info = await getCachedModelInfo(modelId)
  if (!info) return false
  return info.bytes >= (MODEL_MIN_COMPLETE_BYTES[modelId] ?? 50 * 1e6)
}

/** What is available to export for this model (null if nothing cached). */
export async function getCachedModelInfo(modelId: string): Promise<ModelBundleInfo | null> {
  const reqs = await matchingRequests(modelId)
  if (reqs.length === 0) return null
  const cache = await caches.open(CACHE_NAME)
  let bytes = 0
  for (const req of reqs) {
    const res = await cache.match(req)
    if (res) bytes += (await res.blob()).size
  }
  return { files: reqs.length, bytes }
}

export async function exportModelBundle(modelId: string): Promise<Blob> {
  const cache = await caches.open(CACHE_NAME)
  const reqs = await matchingRequests(modelId)
  if (reqs.length === 0) throw new Error('model-not-cached')

  const files: BundleHeader['files'] = []
  const bodies: Blob[] = []
  for (const req of reqs) {
    const path = canonicalPath(req.url, modelId)
    const res = await cache.match(req)
    if (!path || !res) continue
    const blob = await res.blob()
    files.push({
      path,
      size: blob.size,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
    })
    bodies.push(blob)
  }

  const header = new TextEncoder().encode(
    JSON.stringify({ format: 'iany-models/1', model: modelId, files } satisfies BundleHeader),
  )
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, header.length, true)
  return new Blob([new TextEncoder().encode(MAGIC), len, header, ...bodies], {
    type: 'application/octet-stream',
  })
}

export async function importModelBundle(file: File): Promise<{ model: string; files: number }> {
  const magic = new TextDecoder().decode(await file.slice(0, 8).arrayBuffer())
  if (magic !== MAGIC) throw new Error('bundle-invalid')
  const headerLen = new DataView(await file.slice(8, 12).arrayBuffer()).getUint32(0, true)
  const header = JSON.parse(
    new TextDecoder().decode(await file.slice(12, 12 + headerLen).arrayBuffer()),
  ) as BundleHeader
  if (header.format !== 'iany-models/1' || !Array.isArray(header.files)) {
    throw new Error('bundle-invalid')
  }

  const cache = await caches.open(CACHE_NAME)
  let offset = 12 + headerLen
  for (const entry of header.files) {
    const body = file.slice(offset, offset + entry.size)
    offset += entry.size
    // Rewrite under this origin's mirror URL — the key Transformers.js
    // will look up on this device.
    const rest = entry.path.slice(header.model.length + 1)
    const url = `${location.origin}/models/${header.model}/resolve/main/${rest}`
    await cache.put(
      new Request(url),
      new Response(body, {
        headers: {
          'content-type': entry.contentType,
          'content-length': String(entry.size),
        },
      }),
    )
  }
  return { model: header.model, files: header.files.length }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}
