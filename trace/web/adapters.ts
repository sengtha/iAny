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
