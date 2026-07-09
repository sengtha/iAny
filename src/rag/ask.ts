import { ai } from '../ai/client'
import { detectLang, tokenizeForSearch } from '../ai/chunker'
import { hybridSearch } from '../db/search'
import type { ChunkHit } from '../types'

export interface AskResult {
  answer: string
  sources: ChunkHit[]
}

export async function retrieve(question: string, limit = 6): Promise<ChunkHit[]> {
  const [queryEmbedding] = await ai.embed([question], 'query')
  return hybridSearch(queryEmbedding, tokenizeForSearch(question), limit)
}

/**
 * Gemma models fold system instructions into the user turn via the chat
 * template, so we build a single grounded user message. The model is asked
 * to answer in the question's language (Khmer or English).
 */
function buildPrompt(question: string, sources: ChunkHit[]): string {
  const lang = detectLang(question)
  const context = sources
    .map((s, i) => `[${i + 1}] (${s.title})\n${s.text}`)
    .join('\n\n')
  const langInstruction =
    lang === 'km'
      ? 'Answer in Khmer (ភាសាខ្មែរ).'
      : 'Answer in the same language as the question.'
  return [
    'You are iAny, a private offline assistant. Answer the question using ONLY the context below, which comes from the user\'s personal knowledge base.',
    'Cite sources inline as [1], [2] where relevant.',
    `If the context does not contain the answer, say you don't have that information yet and suggest feeding iAny relevant material. ${langInstruction}`,
    '',
    '--- CONTEXT ---',
    context || '(no matching content found)',
    '--- END CONTEXT ---',
    '',
    `Question: ${question}`,
  ].join('\n')
}

export async function ask(
  question: string,
  opts: { onToken?: (t: string, reset?: boolean) => void; limit?: number } = {},
): Promise<AskResult> {
  const sources = await retrieve(question, opts.limit ?? 6)
  const answer = await ai.generate(
    [{ role: 'user', content: buildPrompt(question, sources) }],
    { maxNewTokens: 1024, onToken: opts.onToken },
  )
  return { answer, sources }
}
