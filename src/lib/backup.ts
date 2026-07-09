/**
 * V2 cloud backup: end-to-end encrypted, recovery-code based.
 *
 * The recovery code never leaves the device. From it we derive 512 bits
 * (PBKDF2): the first half is the AES-GCM key, the second half becomes the
 * backup id sent to the server. The server stores only ciphertext under
 * that id — it cannot decrypt a backup, and cannot derive the id of anyone
 * who hasn't shared it. Losing the code means losing the backup, which the
 * UI states loudly.
 */
import { exportPack, importPack, validatePack } from '../db/packs'

const CODE_KEY = 'iany.backupCode'
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

export function getStoredCode(): string | null {
  return localStorage.getItem(CODE_KEY)
}

export function storeCode(code: string): void {
  localStorage.setItem(CODE_KEY, normalizeCode(code))
}

export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  const groups: string[] = []
  for (let i = 0; i < 20; i += 4) groups.push(chars.slice(i, i + 4).join(''))
  return groups.join('-')
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, '').replace(/(.{4})(?=.)/g, '$1-')
}

async function deriveKeyAndId(code: string): Promise<{ key: CryptoKey; id: string }> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizeCode(code)),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('iany-backup-v1'),
        iterations: 250_000,
        hash: 'SHA-256',
      },
      material,
      512,
    ),
  )
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
  const id = Array.from(bits.slice(32), (b) => b.toString(16).padStart(2, '0')).join('')
  return { key, id }
}

export interface BackupInfo {
  exists: boolean
  uploadedAt?: string
}

export async function getBackupInfo(code: string): Promise<BackupInfo> {
  const { id } = await deriveKeyAndId(code)
  const res = await fetch(`/api/backup/${id}`, { method: 'HEAD' })
  if (!res.ok) return { exists: false }
  return { exists: true, uploadedAt: res.headers.get('x-backup-uploaded') ?? undefined }
}

export async function backupNow(code: string): Promise<void> {
  const { key, id } = await deriveKeyAndId(code)
  const pack = await exportPack({ name: 'Cloud backup' })
  const plaintext = new TextEncoder().encode(JSON.stringify(pack))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  const body = new Blob([iv, ciphertext])
  const res = await fetch(`/api/backup/${id}`, { method: 'PUT', body })
  if (!res.ok) throw new Error(`backup-upload-${res.status}`)
}

export async function restoreBackup(code: string): Promise<void> {
  const { key, id } = await deriveKeyAndId(code)
  const res = await fetch(`/api/backup/${id}`)
  if (res.status === 404) throw new Error('backup-not-found')
  if (!res.ok) throw new Error(`backup-download-${res.status}`)
  const data = new Uint8Array(await res.arrayBuffer())
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(0, 12) },
      key,
      data.slice(12),
    )
  } catch {
    throw new Error('backup-decrypt-failed')
  }
  const pack = validatePack(JSON.parse(new TextDecoder().decode(plaintext)))
  await importPack(pack)
}
