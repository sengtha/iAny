import { useState } from 'react'
import { useI18n } from './i18n'
import { ChatView } from './views/ChatView'
import { LibraryView } from './views/LibraryView'
import { PacksView } from './views/PacksView'
import { RadioView } from './views/RadioView'
import { SettingsView } from './views/SettingsView'

type Tab = 'chat' | 'library' | 'packs' | 'radio' | 'settings'

const TAB_ICONS: Record<Tab, string> = {
  chat: '💬',
  library: '📚',
  packs: '📦',
  radio: '📻',
  settings: '⚙️',
}

export default function App() {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('chat')

  const labels: Record<Tab, string> = {
    chat: t('navChat'),
    library: t('navLibrary'),
    packs: t('navPacks'),
    radio: t('navRadio'),
    settings: t('navSettings'),
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <div>
            <h1>iAny</h1>
            <p className="tagline">{t('appTagline')}</p>
          </div>
        </div>
        <a className="home-link" href="/" title={t('navHome')} aria-label={t('navHome')}>
          ← {t('navHome')}
        </a>
      </header>

      <main className="main">
        {tab === 'chat' && <ChatView />}
        {tab === 'library' && <LibraryView />}
        {tab === 'packs' && <PacksView />}
        {tab === 'radio' && <RadioView />}
        {tab === 'settings' && <SettingsView />}
      </main>

      <nav className="tabs">
        {(Object.keys(TAB_ICONS) as Tab[]).map((key) => (
          <button
            key={key}
            className={tab === key ? 'tab active' : 'tab'}
            onClick={() => setTab(key)}
          >
            <span aria-hidden>{TAB_ICONS[key]}</span>
            {labels[key]}
          </button>
        ))}
      </nav>
    </div>
  )
}
