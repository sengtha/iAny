import { createContext, useContext } from 'react'
import type { OcrAdapter, SttAdapter } from './adapters'

/** Host-provided capabilities, read by the OCR/voice buttons. */
export interface TraceCaps {
  ocr?: OcrAdapter
  stt?: SttAdapter
}

export const TraceCtx = createContext<TraceCaps>({})
export const useTraceCaps = () => useContext(TraceCtx)
