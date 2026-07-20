import { createContext, useContext } from 'react'
import type { MatcherAdapter, OcrAdapter, SttAdapter } from './adapters'

/** Host-provided capabilities, read by the OCR/voice/matcher buttons. */
export interface TraceCaps {
  ocr?: OcrAdapter
  stt?: SttAdapter
  matcher?: MatcherAdapter
}

export const TraceCtx = createContext<TraceCaps>({})
export const useTraceCaps = () => useContext(TraceCtx)
