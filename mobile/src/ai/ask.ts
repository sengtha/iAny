import { buildRagMessages, type ChunkHit } from '@iany/core'
import { hybridSearch, type Embedder } from '../db/database'
import { generator } from './generator'

export interface AskResult {
  answer: string
  sources: ChunkHit[]
}

/**
 * Retrieve relevant chunks, then generate a grounded answer, streaming tokens
 * to onToken. The prompt comes from @iany/core (`buildRagMessages`) — the SAME
 * prompt used to SFT the Khmer model and shared with the PWA, so training and
 * inference match. Retrieval reuses the Stage 2 hybrid search (vector + FTS).
 */
export async function ask(
  question: string,
  embedder: Embedder | undefined,
  onToken: (token: string) => void,
): Promise<AskResult> {
  const sources = await hybridSearch(question, embedder, 3)
  const messages = buildRagMessages(question, sources, { topK: 3 })
  const answer = await generator.generate(messages, onToken, 256)
  return { answer, sources }
}
