import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeStreetView } from './views/ContributeStreetView'
import './styles.css'

/**
 * Standalone "Street vehicles" page (served at /street) — a community collector
 * for Cambodia-specific vehicle photos (tuk-tuk, remork, cyclo …), feeding an
 * offline vehicle classifier so the /traffic counter can count tuk-tuks
 * correctly (see docs/SMARTCITY-AI.md). Separate route, like /waste and /crop.
 */
function StreetApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🛺</span>
          <div>
            <h1>{km ? 'យានយន្តតាមផ្លូវ' : 'Street vehicles'}</h1>
            <p>{km ? 'ជួយបង្កើត AI ស្គាល់តុកតុក បើកចំហ' : 'Help build an open tuk-tuk-aware AI'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeStreetView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('street-root')!).render(
  <StrictMode>
    <I18nProvider>
      <StreetApp />
    </I18nProvider>
  </StrictMode>,
)
