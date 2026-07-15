/**
 * Native (mobile) types. The platform-agnostic domain + pack contract lives in
 * @iany/core (shared with the PWA so knowledge packs stay portable); this file
 * re-exports it and adds the NATIVE model registry (GGUF repos for llama.rn /
 * ONNX repos for the TTS voice). Same brain, native packaging.
 */
export type { Language, DocumentRow, ChunkHit, ChatMessage } from '@iany/core'
export { EMBEDDING_DIMS, CHUNK_MAX_CHARS, CHUNK_OVERLAP_SENTENCES } from '@iany/core'

/**
 * Native embedding model: EmbeddingGemma-300m (GGUF, run by llama.rn) — the
 * SAME model the PWA uses, so a knowledge pack embedded on desktop stays
 * searchable on mobile (marketplace/sync portability). Gemma-architecture, so
 * llama.rn (built for Gemma) can load it; officially supported by llama.cpp.
 * Multilingual with strong Khmer. Pulled through the iAny mirror (Hugging Face
 * is blocked in some regions). Matryoshka: we truncate the 768-dim output to
 * 256 + renormalize, exactly like the PWA.
 */
export const EMBEDDING_MODEL_REPO = 'ggml-org/embeddinggemma-300M-GGUF'
/** Candidate GGUF filenames, tried in order; if none match, the embedder asks
 *  the HF metadata proxy for the repo's real .gguf and prefers q8_0. */
export const EMBEDDING_MODEL_FILES = [
  'embeddinggemma-300M-Q8_0.gguf',
  'embeddinggemma-300M-q8_0.gguf',
  'embeddinggemma-300m-Q8_0.gguf',
  'embeddinggemma-300M-f16.gguf',
  'embeddinggemma-300M-F16.gguf',
  'embeddinggemma-300M-Q4_K_M.gguf',
]
// EMBEDDING_DIMS re-exported from @iany/core (pinned app-wide, must match PWA).
/**
 * Native generation model: iAny's fine-tuned Khmer model (Gemma 3 270M,
 * continued-pretrained + SFT on Khmer), converted from safetensors to GGUF via
 * HF's gguf-my-repo Space. ~290 MB q8_0 — fits the 2019 Galaxy S10 (whose
 * llama.rn ceiling is ~300-500 MB, below Gemma 1B's 806 MB). Unlike base 270M
 * (which can't write Khmer at all), this is trained for Khmer. Capable phones
 * use a bigger model for better quality — quality scales with the device.
 */
// The S10 Khmer model: Qwen3 0.6B trimmed to a 32,768-token Khmer vocabulary
// (alphaedge-ai/Qwen3-0.6B-khm-32768, converted to GGUF). The small vocab means
// a tiny logits buffer (loads + runs fast on the S10), it's Khmer-trained, and
// Qwen3 avoids the llama.rn Gemma-3 load bug.
// The S10's working model — its tested ceiling is ~0.6B (1.7B weights won't
// load). Qwen3 0.6B trimmed to a 32k Khmer vocab (alphaedge-ai), then
// fine-tuned on iAny's Khmer corpus (CPT on FineWeb-2 + ParaCrawl) for better
// Khmer. Same 32k vocab -> still ~600MB, loads + runs at ~26 tok/s on the S10.
// To A/B against the base, swap REPO back to '...-khm-32768-Q8_0-GGUF'.
// khm-ft2 = the CPT model + Q&A SFT (Stage B on sengtha/khmer-qa) — it answers
// correctly (picks the right span) instead of grabbing a random context word.
export const GEN_MODEL_REPO = 'sengtha/Qwen3-0.6B-khm-ft2-Q8_0-GGUF'
// Prefer Q4_K_M (~half the size of Q8, and faster on a phone CPU — inference is
// memory-bandwidth-bound, so fewer bytes/token = quicker; small quality cost on
// a 0.6B). Falls back to Q8 automatically: if the Q4 file isn't in the repo yet
// the HEAD probe misses and discoverFile picks the Q8 that's there. Upload a
// Q4_K_M gguf into the same repo to switch the S10 over — no app change needed.
export const GEN_MODEL_FILES = [
  'Qwen3-0.6B-khm-ft2-Q4_K_M.gguf',
  'Qwen3-0.6B-khm-ft2-Q8_0.gguf',
]

/**
 * Native Khmer TTS: a VITS voice trained from scratch on the DDD-Cambodia 727h
 * corpus (single female speaker), exported to ONNX. Runs on-device via
 * onnxruntime-react-native, fully offline. `tts_meta.json` carries the grapheme
 * vocab (Khmer + ASCII + digits) + `add_blank` + sample_rate so the app can
 * tokenize exactly like the training tokenizer.
 */
export const TTS_MODEL_REPO = 'sengtha/khmer-tts-female-v1'
export const TTS_ONNX_FILE = 'khmer_tts.onnx'
export const TTS_META_FILE = 'tts_meta.json'

/** iAny model mirror (Cloudflare worker pull-through cache). */
export const MODEL_MIRROR = 'https://iany.sengtha.workers.dev/models'
/** Read-only HF metadata proxy on the same worker (repo file lists), so the
 *  app can discover the exact GGUF filename instead of guessing. */
export const MODEL_API_MIRROR = 'https://iany.sengtha.workers.dev/hf-api'
/** iAny Radio API (same worker): GET /feed, outlets POST /news. */
export const RADIO_API = 'https://iany.sengtha.workers.dev/radio'

// CHUNK_MAX_CHARS, CHUNK_OVERLAP_SENTENCES, DocumentRow, ChunkHit, ChatMessage
// now come from @iany/core (re-exported at the top) — the single source of truth
// shared with the PWA so knowledge packs line up across platforms.
