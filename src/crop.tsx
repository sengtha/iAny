import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeCropView } from './views/ContributeCropView'
import './styles.css'

/**
 * Standalone "Khmer Crop" page (served at /crop) — a separate route from the iAny
 * app, like /voice and /scan, so a community crop-data drive isn't confused with
 * the knowledge-base product. Light shell (header + language toggle) around the
 * shared ContributeCropView. Feeds an open dataset for an offline crop-health
 * classifier (see docs/VISION-MOBILENET.md).
 */
function CropApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🌱</span>
          <div>
            <h1>{km ? 'ដំណាំខ្មែរ' : 'Khmer Crop'}</h1>
            <p>{km ? 'ជួយបង្កើត AI ពិនិត្យសុខភាពដំណាំ បើកចំហ' : 'Help build an open crop-health AI'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeCropView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('crop-root')!).render(
  <StrictMode>
    <I18nProvider>
      <CropApp />
    </I18nProvider>
  </StrictMode>,
)
