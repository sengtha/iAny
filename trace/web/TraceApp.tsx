import { useState } from 'react'
import { TraceView } from './TraceView'
import { TraceCtx, type TraceCaps } from './context'

const IANY_URL = 'https://iany.app'
const GITHUB_URL = 'https://github.com/sengtha/iAny'
const COMPANY_URL = 'https://www.e-khmer.com'
const COMPANY_NAME = 'E-KHMER Technology Co., Ltd'

/**
 * Self-contained Trace shell (header + language toggle + footer). Manages its
 * own language (Trace is a standalone product), and provides optional OCR/STT
 * capabilities to the tree. A host (iAny, or any deployment) renders this and
 * optionally injects capability adapters.
 */
export function TraceApp({ ocr, stt, matcher }: TraceCaps) {
  const [lang, setLang] = useState<'en' | 'km'>(() => {
    try { return (localStorage.getItem('trace.lang') as 'en' | 'km') || 'en' } catch { return 'en' }
  })
  const set = (l: 'en' | 'km') => { setLang(l); try { localStorage.setItem('trace.lang', l) } catch { /* ignore */ } }
  const km = lang === 'km'
  const L = (en: string, khmer: string) => (km ? khmer : en)

  return (
    <TraceCtx.Provider value={{ ocr, stt, matcher }}>
      <div className="voice-shell">
        <header className="voice-topbar">
          <div className="voice-brand">
            <span aria-hidden>🔖</span>
            <div>
              <h1>
                {km ? 'Trace — ប្រភពដើម' : 'Trace'}
                <span className="trace-exp">{L('Experiment', 'ពិសោធន៍')}</span>
              </h1>
              <p>{km ? 'ភស្តុតាងប្រភពដើម ក្រៅបណ្ដាញ ១០០%' : 'Offline proof of origin — a trust score'}</p>
            </div>
          </div>
          <button className="voice-lang" onClick={() => set(km ? 'en' : 'km')}>{km ? 'EN' : 'ខ្មែរ'}</button>
        </header>

        <main className="voice-main"><TraceView lang={lang} /></main>

        <footer className="trace-foot">
          <div className="trace-foot-brand">
            <span aria-hidden>🔖</span> Trace
            <span className="trace-exp">{L('Experiment', 'ពិសោធន៍')}</span>
          </div>
          <p className="trace-foot-note">
            {L('A use case built on iAny — offline, on-device Khmer AI, with the community, for the community.',
               'ករណីប្រើប្រាស់ផ្អែកលើ iAny — AI ខ្មែរ ក្រៅបណ្ដាញ លើឧបករណ៍ ជាមួយសហគមន៍ សម្រាប់សហគមន៍។')}
          </p>
          <div className="trace-foot-links">
            <a href={IANY_URL}>iAny</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            <span>Apache-2.0</span>
          </div>
          <p className="trace-foot-co">
            © 2026 <a href={COMPANY_URL} target="_blank" rel="noreferrer">{COMPANY_NAME}</a>
          </p>
        </footer>
      </div>
    </TraceCtx.Provider>
  )
}
