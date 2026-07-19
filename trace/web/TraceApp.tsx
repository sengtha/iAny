import { useState } from 'react'
import { TraceView } from './TraceView'
import { TraceCtx, type TraceCaps } from './context'

/**
 * Self-contained Trace shell (header + language toggle). Manages its own
 * language (Trace is a standalone product), and provides optional OCR/STT
 * capabilities to the tree. A host (iAny, or any deployment) renders this and
 * optionally injects capability adapters.
 */
export function TraceApp({ ocr, stt }: TraceCaps) {
  const [lang, setLang] = useState<'en' | 'km'>(() => {
    try { return (localStorage.getItem('trace.lang') as 'en' | 'km') || 'en' } catch { return 'en' }
  })
  const set = (l: 'en' | 'km') => { setLang(l); try { localStorage.setItem('trace.lang', l) } catch { /* ignore */ } }
  const km = lang === 'km'

  return (
    <TraceCtx.Provider value={{ ocr, stt }}>
      <div className="voice-shell">
        <header className="voice-topbar">
          <div className="voice-brand">
            <span aria-hidden>🔖</span>
            <div>
              <h1>{km ? 'Trace — ប្រភពដើម' : 'Trace'}</h1>
              <p>{km ? 'ភស្តុតាងប្រភពដើម ក្រៅបណ្ដាញ ១០០%' : 'Offline proof of origin — a trust score'}</p>
            </div>
          </div>
          <button className="voice-lang" onClick={() => set(km ? 'en' : 'km')}>{km ? 'EN' : 'ខ្មែរ'}</button>
        </header>
        <main className="voice-main"><TraceView lang={lang} /></main>
      </div>
    </TraceCtx.Provider>
  )
}
