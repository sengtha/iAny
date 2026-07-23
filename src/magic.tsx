import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { MagicView } from './views/MagicView'
import './styles.css'

/**
 * Standalone "Magic" experiment (served at /magic) — a gesture-to-command demo:
 * MediaPipe recognizes your hand gesture live and casts a matching visual "spell"
 * on the camera, fully on-device. A playful showcase of gesture control for iAny.
 */
function MagicApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>✨</span>
          <div>
            <h1>{km ? 'វេទមន្តដៃ' : 'Hand Magic'}</h1>
            <p>{km ? 'កាយវិការ → បញ្ជា · ក្រៅបណ្ដាញ' : 'Gesture → command · on-device'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <MagicView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('magic-root')!).render(
  <StrictMode>
    <I18nProvider>
      <MagicApp />
    </I18nProvider>
  </StrictMode>,
)
