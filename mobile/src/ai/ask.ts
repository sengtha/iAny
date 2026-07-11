import { hybridSearch, type Embedder } from '../db/database'
import type { ChunkHit } from '../domain/types'
import { generator } from './generator'

export interface AskResult {
  answer: string
  sources: ChunkHit[]
}

/**
 * Build the exact prompt iAny's Khmer fine-tune was trained on
 * (docs/KAGGLE-STAGE2.md): a Khmer context/question/answer template wrapped in
 * Gemma's turn format, generated as a raw prompt (the model's tokenizer has no
 * inline chat template). Keep context tight — the on-device n_ctx is 1024.
 */
function buildKhmerPrompt(question: string, sources: ChunkHit[]): string {
  const context = sources
    .map((s, i) => {
      const text = s.text.length > 500 ? `${s.text.slice(0, 500)}…` : s.text
      return `[${i + 1}] ${s.title}\n${text}`
    })
    .join('\n\n')
  const prompt = `បរិបទ៖\n${context}\n\nសំណួរ៖ ${question}\nចម្លើយ៖`
  return `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>model\n`
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
  const answer = await generator.generate(buildKhmerPrompt(question, sources), onToken, 128)
  return { answer, sources }
}
