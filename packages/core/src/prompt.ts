/**
 * The grounded-answer prompt — ONE definition shared by both apps AND used
 * verbatim as the SFT training prompt for the Khmer fine-tune. Training and
 * inference prompts must match exactly, or the model answers in a style it
 * wasn't taught. Change it here and re-SFT; never fork it per platform.
 */

import type { ChatMessage, ChunkHit } from './types'

export interface RagPromptOptions {
  /** Max chunks to include as context. */
  topK?: number
  /** Truncate each chunk to this many chars (keeps prefill bounded on weak CPUs). */
  perChunkChars?: number
  /** Qwen3 soft switch to suppress <think> blocks. */
  noThink?: boolean
}

const DEFAULTS: Required<RagPromptOptions> = { topK: 3, perChunkChars: 500, noThink: true }

/** Build the user-turn text from a question + retrieved chunks. */
export function buildRagPrompt(
  question: string,
  sources: ChunkHit[],
  opts: RagPromptOptions = {},
): string {
  const { topK, perChunkChars, noThink } = { ...DEFAULTS, ...opts }
  const context = sources
    .slice(0, topK)
    .map((s, i) => {
      const text = s.text.length > perChunkChars ? `${s.text.slice(0, perChunkChars)}…` : s.text
      return `[${i + 1}] ${s.title}\n${text}`
    })
    .join('\n\n')
  const lines = [
    "Answer the question using only the context below, from the user's notes.",
    'Give a complete answer in Khmer (ភាសាខ្មែរ), 2–4 sentences, including the relevant ' +
      'details from the context. Do not just repeat the question.',
    '',
    `Context:\n${context || '(none)'}`,
    '',
    `Question: ${question}`,
  ]
  if (noThink) lines.push('/no_think')
  return lines.join('\n')
}

/** Chat-message form, for engines that apply a model chat template. */
export function buildRagMessages(
  question: string,
  sources: ChunkHit[],
  opts: RagPromptOptions = {},
): ChatMessage[] {
  return [{ role: 'user', content: buildRagPrompt(question, sources, opts) }]
}
