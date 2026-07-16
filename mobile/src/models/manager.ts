import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import {
  EMBEDDING_MODEL_FILES,
  EMBEDDING_MODEL_REPO,
  GEN_MODEL_FILES,
  GEN_MODEL_REPO,
  OCR_MODEL_FILES,
  OCR_MODEL_REPO,
  TTS_MODEL_REPO,
  TTS_ONNX_FILE,
} from '../domain/types'
import {
  deleteCachedFiles,
  ensureFile,
  ensureModelFile,
  findCachedFile,
  importModelFile,
  listCachedModels,
} from '../ai/modelFile'

/**
 * Model management — the data behind the Models screen. Lets the user choose the
 * LLM quant, download / redownload / delete each model, SHARE a downloaded file
 * phone-to-phone (Bluetooth / Nearby / Quick Share via the OS sheet), and IMPORT
 * a received file so a second device doesn't have to re-download. Built for
 * iAny's offline, low-data context.
 */

export type ModelKind = 'generation' | 'embedding' | 'voice' | 'ocr'

export interface ManagedModel {
  id: string
  kind: ModelKind
  label: string
  note: string
  repo: string
  /** By default these are ALTERNATIVE candidate names (files[0] is canonical for
   *  import). When `bundle` is true they are ALL required (e.g. OCR = det + rec). */
  files: string[]
  /** can it be picked as the active model for its kind? */
  selectable: boolean
  /** true = every entry in `files` is required (a multi-file model). */
  bundle?: boolean
}

// GEN_MODEL_FILES is [Q4, Q8] (Q4 first). Offer both as choices.
const GEN_Q4 = GEN_MODEL_FILES[0]
const GEN_Q8 = GEN_MODEL_FILES[1] ?? GEN_MODEL_FILES[0]

export const MODELS: ManagedModel[] = [
  // gen-q4/gen-q8 use GEN_MODEL_REPO (now ft3, the current model). gen-q4 is
  // first, so it is the DEFAULT active model.
  {
    id: 'gen-q4',
    kind: 'generation',
    label: 'Khmer LLM · Q4',
    note: 'Current model (ft3 — fuller answers). Smaller + faster; best default for the S10.',
    repo: GEN_MODEL_REPO,
    files: [GEN_Q4],
    selectable: true,
  },
  {
    id: 'gen-q8',
    kind: 'generation',
    label: 'Khmer LLM · Q8',
    note: 'Current model (ft3), higher quality — ~2× the size + a bit slower.',
    repo: GEN_MODEL_REPO,
    files: [GEN_Q8],
    selectable: true,
  },
  // ft2 = the older training (shorter answers), kept selectable for comparison.
  {
    id: 'gen-ft2-q4',
    kind: 'generation',
    label: 'Khmer LLM · ft2 · Q4',
    note: 'Older training (shorter answers). Kept for comparison.',
    repo: 'sengtha/Qwen3-0.6B-khm-ft2-Q8_0-GGUF',
    files: ['Qwen3-0.6B-khm-ft2-Q4_K_M.gguf'],
    selectable: true,
  },
  {
    id: 'gen-ft2-q8',
    kind: 'generation',
    label: 'Khmer LLM · ft2 · Q8',
    note: 'Older training, higher quality. Kept for comparison.',
    repo: 'sengtha/Qwen3-0.6B-khm-ft2-Q8_0-GGUF',
    files: ['Qwen3-0.6B-khm-ft2-Q8_0.gguf'],
    selectable: true,
  },
  {
    id: 'embed',
    kind: 'embedding',
    label: 'Semantic search',
    note: 'EmbeddingGemma — powers meaning-based search.',
    repo: EMBEDDING_MODEL_REPO,
    files: EMBEDDING_MODEL_FILES,
    selectable: false,
  },
  {
    id: 'voice',
    kind: 'voice',
    label: 'Khmer voice',
    note: 'On-device TTS — reads the Radio news aloud.',
    repo: TTS_MODEL_REPO,
    files: [TTS_ONNX_FILE],
    selectable: false,
  },
  {
    id: 'ocr',
    kind: 'ocr',
    label: 'Khmer OCR',
    note: 'Reads Khmer text from photos/scans (detector + recognizer, ~25 MB).',
    repo: OCR_MODEL_REPO,
    files: [...OCR_MODEL_FILES],
    selectable: false,
    bundle: true,
  },
]

/* ---- active-generation selection (persisted to a small JSON file) ---- */

const SEL_FILE = `${FileSystem.documentDirectory}model-selection.json`

async function readSel(): Promise<{ generation?: string }> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(SEL_FILE)) as { generation?: string }
  } catch {
    return {}
  }
}
async function writeSel(sel: { generation?: string }): Promise<void> {
  await FileSystem.writeAsStringAsync(SEL_FILE, JSON.stringify(sel))
}

const genModels = () => MODELS.filter((m) => m.kind === 'generation')

/** The user's chosen LLM (defaults to the first = Q4). */
export async function getActiveGenId(): Promise<string> {
  const sel = await readSel()
  const g = genModels()
  return (g.find((m) => m.id === sel.generation) ?? g[0]).id
}

/** repo + files for the active LLM — the generator loads these. */
export async function getActiveGenModel(): Promise<{ repo: string; files: string[] }> {
  const id = await getActiveGenId()
  const m = genModels().find((x) => x.id === id) ?? genModels()[0]
  return { repo: m.repo, files: m.files }
}

export async function setActiveGenId(id: string): Promise<void> {
  const sel = await readSel()
  sel.generation = id
  await writeSel(sel)
}

/* ---- per-model actions ---- */

export interface ModelState {
  downloaded: boolean
  sizeBytes: number
}

export async function modelState(m: ManagedModel): Promise<ModelState> {
  if (m.bundle) {
    // Every file is required: downloaded only when ALL are present; size sums.
    let sizeBytes = 0
    for (const file of m.files) {
      const f = await findCachedFile([file])
      if (!f) return { downloaded: false, sizeBytes }
      sizeBytes += f.size
    }
    return { downloaded: true, sizeBytes }
  }
  const f = await findCachedFile(m.files)
  return { downloaded: f != null, sizeBytes: f?.size ?? 0 }
}

/** Download (or resume) this model through the mirror. */
export async function downloadModel(
  m: ManagedModel,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (m.bundle) {
    // Fetch every required file; report combined progress across them.
    const n = m.files.length
    for (let i = 0; i < n; i++) {
      await ensureFile(m.repo, m.files[i], (f) => onProgress?.((i + f) / n))
    }
    return
  }
  await ensureModelFile(m.repo, m.files, onProgress)
}

export async function removeModel(m: ManagedModel): Promise<void> {
  await deleteCachedFiles(m.files)
}

/** Hand a downloaded model file to the OS share sheet (Bluetooth / Nearby /
 *  Quick Share / etc.). Returns false if it isn't downloaded or sharing is
 *  unavailable. */
export async function shareModel(m: ManagedModel): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false
  if (m.bundle) {
    // Share each required file in turn (the OS sheet handles one at a time);
    // the receiver imports each. Returns true if at least one was shared.
    let shared = false
    for (const file of m.files) {
      const f = await findCachedFile([file])
      if (!f) continue
      await Sharing.shareAsync(f.uri, {
        mimeType: 'application/octet-stream',
        dialogTitle: `Share ${m.label} — ${file}`,
      })
      shared = true
    }
    return shared
  }
  const f = await findCachedFile(m.files)
  if (!f) return false
  await Sharing.shareAsync(f.uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: `Share ${m.label}`,
  })
  return true
}

/** Import a received model file (picked by the user) into the cache under this
 *  model's canonical name, so the app uses it without downloading. */
export async function importModel(m: ManagedModel): Promise<boolean> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true })
  if (res.canceled || !res.assets || res.assets.length === 0) return false
  const asset = res.assets[0]
  // For a bundle, save the picked file under whichever required name it matches
  // (by basename) so importing det + rec separately lands them correctly.
  let dest = m.files[0]
  if (m.bundle) {
    const picked = (asset.name ?? '').toLowerCase()
    dest = m.files.find((f) => picked.includes(f.toLowerCase())) ?? m.files[0]
  }
  await importModelFile(asset.uri, dest.replace(/\//g, '_'))
  return true
}

export function formatBytes(n: number): string {
  if (n <= 0) return '0 MB'
  if (n < 1e9) return `${Math.round(n / 1e6)} MB`
  return `${(n / 1e9).toFixed(2)} GB`
}

/** Total bytes of all downloaded model files on this device. */
export async function totalModelStorage(): Promise<number> {
  const files = await listCachedModels()
  return files.reduce((sum, f) => sum + f.size, 0)
}
