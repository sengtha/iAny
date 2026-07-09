import { EMBEDDING_MODEL_ID } from '../types'

export interface DiagnosticResult {
  name: string
  ok: boolean
  detail: string
}

async function probe(name: string, url: string): Promise<DiagnosticResult> {
  const started = performance.now()
  try {
    const res = await fetch(url, { cache: 'no-store' })
    const ms = Math.round(performance.now() - started)
    return {
      name,
      ok: res.ok,
      detail: `HTTP ${res.status} · ${ms}ms`,
    }
  } catch (e) {
    return {
      name,
      ok: false,
      detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    }
  }
}

/** Pinpoints where model downloads fail: our own origin, the Hugging Face
 *  API host, or the CDN that actually serves the weight files. */
export async function runDiagnostics(): Promise<DiagnosticResult[]> {
  return Promise.all([
    probe('App origin (/ort/)', `/ort/ort-wasm-simd-threaded.mjs`),
    probe(
      'huggingface.co',
      `https://huggingface.co/${EMBEDDING_MODEL_ID}/resolve/main/config.json`,
    ),
    probe(
      'HF CDN (weights)',
      `https://cdn-lb.huggingface.co/robots.txt`,
    ),
  ])
}
