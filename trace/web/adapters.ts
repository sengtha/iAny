/**
 * Optional capabilities Trace can use if a host provides them. Trace works
 * fully without these (the user types instead) — iAny injects on-device Khmer
 * OCR + STT; a standalone deployment can inject any engine, or none.
 */

/** Read text from an image (e.g. a product label). */
export interface OcrAdapter {
  recognizeImage(blob: Blob): Promise<string>
}

export interface SttState {
  phase: 'idle' | 'recording' | 'loading' | 'transcribing' | 'error'
  download?: number
}

/** Record + transcribe speech (e.g. a spoken product story). */
export interface SttAdapter {
  supported(): boolean
  subscribe(cb: (s: SttState) => void): () => void
  startRecording(): Promise<void>
  stopAndTranscribe(): Promise<string>
}

/**
 * Optional learned image matcher (e.g. MediaPipe Image Embedder). When provided
 * and switched on, Trace attaches a learned embedding to each photo for a sharper,
 * more lighting/angle-robust appearance match. The classical descriptor is ALWAYS
 * computed too, so a capsule stays verifiable by anyone — model or not. This is an
 * opt-in "better matching" tier because it downloads a small model, unlike the
 * instant, zero-download classical path.
 */
export interface MatcherAdapter {
  /** Short label for the toggle, e.g. "Better matching". */
  label: string
  /** Approx download size in MB, shown beside the toggle (optional). */
  sizeMb?: number
  /** Load the model lazily (may download on first call). Resolves when ready. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>
  /** L2-normalized learned embedding for a photo, or null if it couldn't run. */
  embed(blob: Blob): Promise<number[] | null>
}
