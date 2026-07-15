/**
 * Knowledge-pack integrity — shared by the PWA and mobile so a pack that passes
 * on one side passes on the other. `packChecksum` is a fast, deterministic
 * (non-crypto) content hash; `verifyPack` validates format/dims/counts and, when
 * present, the checksum — catching a truncated Bluetooth/Nearby transfer before
 * a half-file is imported.
 */

import { EMBEDDING_DIMS, EMBEDDING_MODEL, PACK_FORMAT, type KnowledgePack, type PackChunk, type PackDocument } from './types'

/** FNV-1a 32-bit over the pack's content. Order-stable, platform-stable. */
export function packChecksum(documents: PackDocument[], chunks: PackChunk[]): string {
  let h = 0x811c9dc5
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
  }
  for (const d of documents) {
    mix(d.id)
    mix('')
    mix(d.content)
    mix('')
  }
  for (const c of chunks) {
    mix(c.document_id)
    mix(String(c.seq))
    mix(c.text)
    mix(c.embedding)
    mix('')
  }
  return (h >>> 0).toString(16)
}

export interface PackCheck {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** Validate a pack before import. `errors` block the import; `warnings` are safe
 *  to proceed through (e.g. a different embedding size → keyword-only). */
export function verifyPack(pack: KnowledgePack): PackCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const m = pack?.manifest
  if (!m || m.format !== PACK_FORMAT) {
    errors.push('Not an iAny pack file.')
    return { ok: false, errors, warnings }
  }
  if (!Array.isArray(pack.documents) || !Array.isArray(pack.chunks)) {
    errors.push('Malformed pack (missing documents or chunks).')
    return { ok: false, errors, warnings }
  }
  if (m.checksum) {
    if (packChecksum(pack.documents, pack.chunks) !== m.checksum) {
      errors.push('Checksum mismatch — the file is corrupted or truncated. Re-share it.')
    }
  }
  if (m.counts && (m.counts.documents !== pack.documents.length || m.counts.chunks !== pack.chunks.length)) {
    warnings.push('Item counts do not match the contents — the file may be incomplete.')
  }
  if (m.dims !== EMBEDDING_DIMS) {
    warnings.push(
      `Different embedding size (${m.dims} vs ${EMBEDDING_DIMS}) — vectors will be skipped; keyword search still works.`,
    )
  }
  if (m.embeddingModel && m.embeddingModel !== EMBEDDING_MODEL) {
    warnings.push(`Different embedding model (${m.embeddingModel}) — semantic search quality may vary.`)
  }
  return { ok: errors.length === 0, errors, warnings }
}
