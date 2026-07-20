import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeSpeciesView } from './views/ContributeSpeciesView'
import './styles.css'

/**
 * Standalone "Nature ID" page (served at /species) — a community collector for
 * biodiversity + mosquito (disease-vector) photos, feeding an offline nature-ID
 * classifier (see docs/ENVIRONMENT-AI.md).
 */
function SpeciesApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🌿</span>
          <div>
            <h1>{km ? 'ធម្មជាតិខ្មែរ' : 'Khmer Nature'}</h1>
            <p>{km ? 'ជួយបង្កើត AI ចាំណាំធម្មជាតិ បើកចំហ' : 'Help build an open nature-ID AI'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeSpeciesView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('species-root')!).render(
  <StrictMode>
    <I18nProvider>
      <SpeciesApp />
    </I18nProvider>
  </StrictMode>,
)
