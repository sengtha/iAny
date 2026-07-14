import { hybridSearch, type Embedder } from '../db/database'
import type { ChunkHit } from '../domain/types'
import { generator, type GenMessage } from './generator'

export interface AskResult {
  answer: string
  sources: ChunkHit[]
}

/**
 * Build a grounded chat message. Passed as `messages`, so llama.rn applies the
 * model's own chat template (Qwen's ChatML, Gemma's turns, etc.). The generator
 * runs n_ctx=2048, so we can afford a few fuller chunks (top-3, ~500 chars each)
 * — starving the model of context is what makes answers one-liners.
 */
function buildMessages(question: string, sources: ChunkHit[]): GenMessage[] {
  const context = sources
    .slice(0, 3)
    .map((s, i) => {
      const text = s.text.length > 500 ? `${s.text.slice(0, 500)}…` : s.text
      return `[${i + 1}] ${s.title}\n${text}`
    })
    .join('\n\n')
  const content = [
    "Answer the question using only the context below, from the user's notes.",
    // Ask for a complete answer, not a one-liner — ft2 is SFT'd terse, so nudge
    // it to include the relevant details it can find in the context.
    'Give a complete answer in Khmer (ភាសាខ្មែរ), 2–4 sentences, including the' +
      ' relevant details from the context. Do not just repeat the question.',
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
  const sources = await hybridSearch(question, embedder, 3)
  const answer = await generator.generate(buildMessages(question, sources), onToken, 256)
  return { answer, sources }
}
