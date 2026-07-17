import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeView } from './views/ContributeView'
import './styles.css'

/**
 * Standalone "Khmer Voice" page (served at /voice) — a separate route from the
 * iAny app so a school's data-collection drive never gets confused with the
 * knowledge-base product. Its own light shell (header + language toggle +
 * footer) wraps the shared ContributeView; no service worker, models, or DB.
 */
function VoiceApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🎤</span>
          <div>
            <h1>{km ? 'សំឡេងខ្មែរ' : 'Khmer Voice'}</h1>
            <p>{km ? 'ជួយបង្កើតការបំប្លែងសំឡេងខ្មែរបើកចំហ' : 'Help build an open Khmer speech-to-text'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('voice-root')!).render(
  <StrictMode>
    <I18nProvider>
      <VoiceApp />
    </I18nProvider>
  </StrictMode>,
)
