import { hybridSearch, type Embedder } from '../db/database'
import { detectLang } from '../domain/chunk'
import type { ChunkHit } from '../domain/types'
import { generator, type GenMessage } from './generator'

export interface AskResult {
  answer: string
  sources: ChunkHit[]
}

/**
 * Build a single grounded user turn. Gemma folds any system instruction into
 * the user message via its chat template, so we send one user message with the
 * retrieved context and the question, and ask for the question's language.
 */
function buildMessages(question: string, sources: ChunkHit[]): GenMessage[] {
  // Keep context tight — the on-device n_ctx is small (1024). Cap each chunk so
  // 3 sources + question + answer fit.
  const context = sources
    .map((s, i) => {
      const text = s.text.length > 500 ? `${s.text.slice(0, 500)}…` : s.text
      return `[${i + 1}] ${s.title}\n${text}`
    })
    .join('\n\n')
  const langInstruction =
    detectLang(question) === 'km'
      ? 'Answer in Khmer (ភាសាខ្មែរ).'
      : 'Answer in the same language as the question.'
  const content = [
    "You are iAny, a private offline assistant. Answer the question using ONLY the context below, which comes from the user's own notes.",
    `Be concise and factual — no speculation beyond the context. If the context does not contain the answer, say so briefly. ${langInstruction}`,
    '',
    '--- CONTEXT ---',
    context || '(no matching content found)',
    '--- END CONTEXT ---',
    '',
    `Question: ${question}`,
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
  const answer = await generator.generate(buildMessages(question, sources), onToken)
  return { answer, sources }
}
