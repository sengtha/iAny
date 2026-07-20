import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { GardenView } from './views/GardenView'
import './styles.css'

/**
 * Standalone "Garden" page (served at /garden) — create signed, verifiable
 * garden/tree observations on-device (the Grove protocol, see grove/SPEC.md). The
 * phone is the source of truth; records are exportable to any node / CamboVerse.
 */
function GardenApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🌳</span>
          <div>
            <h1>{km ? 'សួន' : 'Garden'}</h1>
            <p>{km ? 'កំណត់ត្រាកាបូនសួន ចុះហត្ថលេខាលើឧបករណ៍' : 'Signed garden-carbon records, on your device'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <GardenView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('garden-root')!).render(
  <StrictMode>
    <I18nProvider>
      <GardenApp />
    </I18nProvider>
  </StrictMode>,
)
