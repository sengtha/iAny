import { ai, getGenModelChoice } from '../ai/client'
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
  // The tiny tier runs on weak devices, and prompt length is the real
  // memory killer there: Gemma's 262k vocabulary means the prefill logits
  // tensor costs ~1 MB per prompt token, so a 1000-token RAG prompt spikes
  // ~1 GB regardless of model size. Keep the prompt drastically short.
  const tiny = getGenModelChoice() === 'tiny'
  const sources = await retrieve(question, opts.limit ?? (tiny ? 2 : 6))
  const promptSources = tiny
    ? sources.map((s) => ({
        ...s,
        text: s.text.length > 300 ? `${s.text.slice(0, 300)}…` : s.text,
      }))
    : sources
  const answer = await ai.generate(
    [{ role: 'user', content: buildPrompt(question, promptSources) }],
    { maxNewTokens: tiny ? 192 : 1024, onToken: opts.onToken },
  )
  return { answer, sources }
}
