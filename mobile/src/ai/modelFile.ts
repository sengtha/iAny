import * as FileSystem from 'expo-file-system'
import { MODEL_API_MIRROR, MODEL_MIRROR } from '../domain/types'

/**
 * Shared GGUF download + discovery, pulled through the iAny mirror. Same flow
 * proven by the embedder: try cached files, probe candidate filenames on the
 * mirror, then ask the HF metadata proxy for the repo's real .gguf if the
 * guesses miss. Downloads are resumable with progress and atomic (.part ->
 * final).
 */

const MODEL_DIR = `${FileSystem.documentDirectory}models/`

/** Native module errors often arrive with an empty message. Squeeze out
 *  whatever detail exists — message, code, cause, or stringified body. */
export function errStr(e: unknown): string {
  if (e instanceof Error) {
    const anyE = e as { code?: string | number; cause?: unknown }
    const parts = [e.message || e.name]
    if (anyE.code !== undefined) parts.push(`code=${anyE.code}`)
    if (anyE.cause) parts.push(`cause=${String(anyE.cause)}`)
    return parts.filter(Boolean).join(' ') || 'Error with no message'
  }
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

function resolveUrl(repo: string, file: string): string {
  return `${MODEL_MIRROR}/${repo}/resolve/main/${file}`
}

/** Ask the HF metadata proxy for the repo's actual GGUF files; prefer q4 (for
 *  generation models) or whatever is present. Returns null if unreachable. */
async function discoverFile(repo: string): Promise<string | null> {
  try {
    const res = await fetch(`${MODEL_API_MIRROR}/models/${repo}`)
    if (!res.ok) return null
    const data = (await res.json()) as { siblings?: { rfilename: string }[] }
    const files = (data.siblings ?? [])
      .map((s) => s.rfilename)
      .filter((f) => f.toLowerCase().endsWith('.gguf'))
    return (
      files.find((f) => /q4_k_m/i.test(f)) ??
      files.find((f) => /q4_0/i.test(f)) ??
      files.find((f) => /q8_0/i.test(f)) ??
      files.find((f) => /f16/i.test(f)) ??
      files[0] ??
      null
    )
  } catch {
    return null
  }
}

/**
 * Ensure the model GGUF is on disk; returns its local path. Downloads it once
 * (through the mirror) if missing.
 */
export async function ensureModelFile(
  repo: string,
  candidates: string[],
  onProgress?: (fraction: number) => void,
): Promise<string> {
  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true }).catch(() => {})

  // Already downloaded?
  for (const file of candidates) {
    const dest = MODEL_DIR + file
    const info = await FileSystem.getInfoAsync(dest)
    if (info.exists && info.size && info.size > 1_000_000) return dest
  }

  // Which candidate does the mirror have? Else discover the real filename.
  let chosen: string | null = null
  for (const file of candidates) {
    try {
      const head = await fetch(resolveUrl(repo, file), { method: 'HEAD' })
      if (head.ok) {
        chosen = file
        break
      }
    } catch {
      // try next
    }
  }
  if (!chosen) chosen = await discoverFile(repo)
  if (!chosen) throw new Error(`no .gguf found for ${repo}`)

  // A discovered filename might already be cached from a prior run.
  const finalDest = MODEL_DIR + chosen
  const cached = await FileSystem.getInfoAsync(finalDest)
  if (cached.exists && cached.size && cached.size > 1_000_000) return finalDest

  const tmp = `${finalDest}.part`
  await FileSystem.deleteAsync(tmp, { idempotent: true })
  const resumable = FileSystem.createDownloadResumable(
    resolveUrl(repo, chosen),
    tmp,
    {},
    (p) => {
      const total = p.totalBytesExpectedToWrite
      if (total > 0) onProgress?.(p.totalBytesWritten / total)
    },
  )
  const res = await resumable.downloadAsync()
  if (!res || (res.status && res.status >= 400)) {
    await FileSystem.deleteAsync(tmp, { idempotent: true })
    throw new Error(`download failed (status ${res?.status ?? 'unknown'})`)
  }
  await FileSystem.moveAsync({ from: tmp, to: finalDest })
  return finalDest
}
