import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { BrailleView } from './views/BrailleView'
import './styles.css'

/**
 * Standalone "Khmer Braille" page (served at /braille) — a separate route from
 * the iAny app, like /voice and /scan. Light shell around BrailleView.
 */
function BrailleApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>⠿</span>
          <div>
            <h1>{km ? 'អក្សរផុសខ្មែរ' : 'Khmer Braille'}</h1>
            <p>{km ? 'បម្លែងអក្សរខ្មែរទៅជាអក្សរផុស' : 'Convert Khmer text to Braille — free & offline'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>
      <main className="voice-main">
        <BrailleView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('braille-root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrailleApp />
    </I18nProvider>
  </StrictMode>,
)
