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

/**
 * Download ONE specific file (e.g. an .onnx) through the mirror, cached on disk.
 * Unlike ensureModelFile it doesn't guess/discover — the caller knows the name.
 */
export async function ensureFile(
  repo: string,
  file: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true }).catch(() => {})
  const dest = MODEL_DIR + file.replace(/\//g, '_')
  const info = await FileSystem.getInfoAsync(dest)
  if (info.exists && info.size && info.size > 1_000_000) return dest

  const tmp = `${dest}.part`
  await FileSystem.deleteAsync(tmp, { idempotent: true })
  const resumable = FileSystem.createDownloadResumable(resolveUrl(repo, file), tmp, {}, (p) => {
    const total = p.totalBytesExpectedToWrite
    if (total > 0) onProgress?.(p.totalBytesWritten / total)
  })
  const res = await resumable.downloadAsync()
  if (!res || (res.status && res.status >= 400)) {
    await FileSystem.deleteAsync(tmp, { idempotent: true })
    throw new Error(`download failed (status ${res?.status ?? 'unknown'}) for ${file}`)
  }
  await FileSystem.moveAsync({ from: tmp, to: dest })
  return dest
}

/** Fetch a small JSON file (e.g. tts_meta.json) through the mirror. */
export async function fetchModelJson<T>(repo: string, file: string): Promise<T> {
  const res = await fetch(resolveUrl(repo, file))
  if (!res.ok) throw new Error(`fetch ${file} failed (${res.status})`)
  return (await res.json()) as T
}

/** Delete every cached model file so the next load re-downloads fresh. Used by
 *  the "Redownload models" action (e.g. after a model is updated on the server). */
export async function clearModelCache(): Promise<void> {
  await FileSystem.deleteAsync(MODEL_DIR, { idempotent: true })
  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true }).catch(() => {})
}

/* ------------------------------------------------------------------ *
 * Model management: list, locate, delete, share, import. Powers the   *
 * Models screen (choose / download / redownload / share / import).    *
 * ------------------------------------------------------------------ */

export interface CachedModelFile {
  name: string
  size: number
  uri: string
}

/** ensureFile() stores under a slash-flattened name; ensureModelFile() stores
 *  the raw filename. Try both so any candidate resolves to its on-disk file. */
function candidateNames(file: string): string[] {
  return [file, file.replace(/\//g, '_')]
}

/** List every complete model file on disk (skips .part downloads). */
export async function listCachedModels(): Promise<CachedModelFile[]> {
  const dir = await FileSystem.getInfoAsync(MODEL_DIR)
  if (!dir.exists) return []
  const names = await FileSystem.readDirectoryAsync(MODEL_DIR).catch(() => [] as string[])
  const out: CachedModelFile[] = []
  for (const name of names) {
    if (name.endsWith('.part')) continue
    const uri = MODEL_DIR + name
    const info = await FileSystem.getInfoAsync(uri)
    if (info.exists && !info.isDirectory) out.push({ name, size: info.size ?? 0, uri })
  }
  return out
}

/** The on-disk file for one of these candidate filenames, or null if missing. */
export async function findCachedFile(candidates: string[]): Promise<CachedModelFile | null> {
  const cached = await listCachedModels()
  const wanted = new Set(candidates.flatMap(candidateNames))
  return cached.find((f) => wanted.has(f.name)) ?? null
}

/** Delete the on-disk copies of these candidate filenames (a per-model "remove"). */
export async function deleteCachedFiles(candidates: string[]): Promise<void> {
  const wanted = new Set(candidates.flatMap(candidateNames))
  for (const name of wanted) {
    await FileSystem.deleteAsync(MODEL_DIR + name, { idempotent: true })
    await FileSystem.deleteAsync(MODEL_DIR + name + '.part', { idempotent: true })
  }
}

/** Copy a received file (e.g. shared over Bluetooth/Nearby, picked by the user)
 *  into the model cache so the app can use it without downloading. */
export async function importModelFile(srcUri: string, destName: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true }).catch(() => {})
  const dest = MODEL_DIR + destName
  await FileSystem.deleteAsync(dest, { idempotent: true })
  await FileSystem.copyAsync({ from: srcUri, to: dest })
  return dest
}
