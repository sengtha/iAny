import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { I18nProvider } from './i18n'
import './styles.css'

registerSW({ immediate: true })

// Without persistence the browser may evict IndexedDB (the whole knowledge
// base) and cached model weights under storage pressure.
navigator.storage?.persist?.().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
