import { hybridSearch, type Embedder } from '../db/database'
import type { ChunkHit } from '../domain/types'
import { generator, type GenMessage } from './generator'

export interface AskResult {
  answer: string
  sources: ChunkHit[]
}

/**
 * Build a grounded chat message. Passed as `messages`, so llama.rn applies the
 * model's own chat template (Qwen's ChatML, Gemma's turns, etc.). Context is
 * kept tight — the on-device n_ctx is small (256) on weak devices.
 */
function buildMessages(question: string, sources: ChunkHit[]): GenMessage[] {
  const context = sources
    .slice(0, 1)
    .map((s, i) => {
      const text = s.text.length > 250 ? `${s.text.slice(0, 250)}…` : s.text
      return `[${i + 1}] ${s.title}\n${text}`
    })
    .join('\n\n')
  const content = [
    "Answer the question using only the context below, from the user's notes.",
    'Be brief. Answer in Khmer (ភាសាខ្មែរ).',
    '',
    `Context:\n${context || '(none)'}`,
    '',
    `Question: ${question}`,
    // Qwen3 soft switch: disable its <think> reasoning block.
    '/no_think',
  ].join('\n')
  return [{ role: 'user', content }]
}

/**
 * Retrieve relevant chunks, then generate a grounded answer, streaming tokens
 * to onToken. Retrieval reuses the Stage 2 hybrid search (vector + FTS).
 */
export async function ask(
  question: string,
  embedder: Embedder | undefined,
  onToken: (token: string) => void,
): Promise<AskResult> {
  const sources = await hybridSearch(question, embedder, 2)
  const answer = await generator.generate(buildMessages(question, sources), onToken, 128)
  return { answer, sources }
}
