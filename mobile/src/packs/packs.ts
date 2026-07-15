import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import { randomUUID } from 'expo-crypto'
import {
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_SENTENCES,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  PACK_FORMAT,
  type KnowledgePack,
} from '@iany/core'
import { exportPackData, importPackData } from '../db/database'

/**
 * Knowledge-pack sharing. Export the on-device knowledge base as a portable
 * iany-pack/1 file, hand it to the OS share sheet (Bluetooth / Nearby / Quick
 * Share) so another phone can Import it — no re-typing, no server. Same format
 * as the PWA, so packs cross platforms.
 */

async function buildPack(name: string, author = '', description = ''): Promise<KnowledgePack> {
  const { documents, chunks } = await exportPackData()
  return {
    manifest: {
      format: PACK_FORMAT,
      id: randomUUID(),
      name: name.trim() || 'iAny pack',
      description,
      author,
      language: 'mixed',
      embeddingModel: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      chunking: { maxChars: CHUNK_MAX_CHARS, overlapSentences: CHUNK_OVERLAP_SENTENCES },
      createdAt: new Date().toISOString(),
      counts: { documents: documents.length, chunks: chunks.length },
    },
    documents,
    chunks,
  }
}

function safeName(s: string): string {
  return (s || 'pack').replace(/[^\wក-៿-]+/g, '_').slice(0, 40) || 'pack'
}

/** Build the pack, write it to a file, hand it to the OS share sheet. */
export async function exportAndSharePack(name: string): Promise<{ shared: boolean; documents: number }> {
  const pack = await buildPack(name)
  const uri = `${FileSystem.cacheDirectory}${safeName(name)}.iany-pack.json`
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(pack), {
    encoding: FileSystem.EncodingType.UTF8,
  })
  const documents = pack.manifest.counts.documents
  if (!(await Sharing.isAvailableAsync())) return { shared: false, documents }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle: `Share "${pack.manifest.name}"`,
  })
  return { shared: true, documents }
}

/** Pick a received pack file and import it. */
export async function importPackFromFile(): Promise<{ name: string; documents: number } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ['application/json', '*/*'],
  })
  if (res.canceled || !res.assets || res.assets.length === 0) return null
  const raw = await FileSystem.readAsStringAsync(res.assets[0].uri)
  const pack = JSON.parse(raw) as KnowledgePack
  if (!pack || !pack.manifest || pack.manifest.format !== PACK_FORMAT) {
    throw new Error('Not an iAny pack file.')
  }
  await importPackData(
    {
      id: pack.manifest.id,
      name: pack.manifest.name,
      description: pack.manifest.description,
      author: pack.manifest.author,
    },
    pack.documents ?? [],
    pack.chunks ?? [],
  )
  return { name: pack.manifest.name, documents: pack.documents?.length ?? 0 }
}
