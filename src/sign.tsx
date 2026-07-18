import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeSignView } from './views/ContributeSignView'
import './styles.css'

/**
 * Standalone "Khmer Sign" page (served at /sign) — a separate route from the
 * iAny app, like /voice and /scan, so a community sign-language data drive isn't
 * confused with the knowledge-base product. Light shell around ContributeSignView.
 */
function SignApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🤟</span>
          <div>
            <h1>{km ? 'ភាសាសញ្ញាខ្មែរ' : 'Khmer Sign'}</h1>
            <p>{km ? 'ជួយបង្កើតការស្គាល់ភាសាសញ្ញាបើកចំហ' : 'Help build an open Khmer Sign Language dataset'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeSignView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('sign-root')!).render(
  <StrictMode>
    <I18nProvider>
      <SignApp />
    </I18nProvider>
  </StrictMode>,
)
