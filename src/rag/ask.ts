import { ai, getGenModelChoice, getLastGenDevice } from '../ai/client'
import { detectLang, tokenizeForSearch } from '../ai/chunker'
import { hybridSearch } from '../db/search'
import { genModelSpec, type ChunkHit } from '../types'

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
    "You are iAny, a private offline assistant. Answer the question using ONLY the context below, which comes from the user's personal knowledge base.",
    'Write a clear, professional answer in Markdown: lead with the direct answer, use short paragraphs, and use bullet points or **bold** only when they genuinely aid readability. Cite sources inline as [1], [2].',
    'Be concise and factual — no filler, no speculation beyond the context.',
    `If the context does not contain the answer, say so briefly and suggest feeding iAny relevant material. ${langInstruction}`,
    '',
    '--- CONTEXT ---',
    context || '(no matching content found)',
    '--- END CONTEXT ---',
    '',
    `Question: ${question}`,
  ].join('\n')
}

/**
 * Extractive answers for Khmer questions on the tiny tier: the 270M model
 * cannot write Khmer (yet — see docs/FINETUNE-KHMER.md), so instead of
 * generating broken text, answer by quoting the best-matching passages
 * verbatim. The Khmer is perfect by construction — it is the user's own
 * content. Replaced by real generation once the fine-tuned model ships.
 */
function extractiveAnswer(sources: ChunkHit[]): string {
  const quotes = sources
    .slice(0, 2)
    .map((s, i) => `**[${i + 1}] ${s.title}**\n\n> ${s.text.replace(/\n/g, '\n> ')}`)
    .join('\n\n')
  return `យោងតាមឯកសាររបស់អ្នក៖\n\n${quotes}`
}

export async function ask(
  question: string,
  opts: { onToken?: (t: string, reset?: boolean) => void; limit?: number } = {},
): Promise<AskResult> {
  // The tiny tier runs on weak devices, and prompt length is the real
  // memory killer there: Gemma's 262k vocabulary means the prefill logits
  // tensor costs ~1 MB per prompt token, so a 1000-token RAG prompt spikes
  // ~1 GB regardless of model size. Keep the prompt drastically short.
  // iAny's fine-tuned Khmer model: generate a real grounded answer using the
  // exact prompt it was trained on (docs/KAGGLE-STAGE2.md).
  if (genModelSpec(getGenModelChoice()).khmerRag) {
    const sources = await retrieve(question, 3)
    if (!sources.length) return { answer: '', sources }
    const context = sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.text}`).join('\n\n')
    const prompt = `បរិបទ៖\n${context}\n\nសំណួរ៖ ${question}\nចម្លើយ៖`
    // The ONNX-exported tokenizer has no inline chat template, so apply the
    // Gemma turn format manually and generate as raw text. The tokenizer
    // still turns <start_of_turn>/<end_of_turn> into their special tokens.
    const formatted = `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>model\n`
    const answer = await ai.generate([{ role: 'user', content: formatted }], {
      maxNewTokens: 200,
      raw: true,
      onToken: opts.onToken,
    })
    return { answer, sources }
  }

  const tiny = getGenModelChoice() === 'tiny'
  if (tiny && detectLang(question) === 'km') {
    const sources = await retrieve(question, 4)
    return { answer: sources.length ? extractiveAnswer(sources) : '', sources }
  }
  // CPU (wasm) generation gets the same protection on any model size —
  // the logits spike scales with prompt length, not weights.
  const cpu = getLastGenDevice() === 'wasm'
  const profile = tiny
    ? { limit: 2, chars: 300, maxNewTokens: 192 }
    : cpu
      ? { limit: 3, chars: 400, maxNewTokens: 256 }
      : { limit: 6, chars: Infinity, maxNewTokens: 1024 }
  const sources = await retrieve(question, opts.limit ?? profile.limit)
  const promptSources =
    profile.chars === Infinity
      ? sources
      : sources.map((s) => ({
          ...s,
          text: s.text.length > profile.chars ? `${s.text.slice(0, profile.chars)}…` : s.text,
        }))
  // Qwen3 thinks out loud unless told not to ('/no_think' soft switch).
  const noThink = genModelSpec(getGenModelChoice()).noThink ? '\n/no_think' : ''
  const answer = await ai.generate(
    [{ role: 'user', content: buildPrompt(question, promptSources) + noThink }],
    { maxNewTokens: profile.maxNewTokens, onToken: opts.onToken },
  )
  return { answer, sources }
}
