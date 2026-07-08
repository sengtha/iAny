import { useEffect, useState } from 'react'
import { ai } from '../ai/client'
import { useModelStatus } from '../hooks/useModelStatus'
import { useI18n } from '../i18n'
import { getStats, wipeDatabase, type DbStats } from '../db/documents'
import type { Language, ModelProgress } from '../types'

function ModelCard({ label, model, onDownload }: {
  label: string
  model: ModelProgress
  onDownload: () => void
}) {
  const { t } = useI18n()
  const statusText = {
    idle: t('settingsModelIdle'),
    loading: t('settingsModelLoading'),
    ready: t('settingsModelReady'),
    error: t('settingsModelError'),
    unsupported: t('settingsModelUnsupported'),
  }[model.status]

  return (
    <div className="card doc">
      <div>
        <strong>{label}</strong>
        <p className="hint">{statusText}</p>
        {model.status === 'loading' && <progress value={model.progress} max={1} />}
      </div>
      {model.status === 'idle' && (
        <button className="primary" onClick={onDownload}>
          {t('settingsDownload')}
        </button>
      )}
    </div>
  )
}

export function SettingsView() {
  const { t, lang, setLang } = useI18n()
  const status = useModelStatus()
  const [stats, setStats] = useState<DbStats | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    void getStats().then(setStats)
    void navigator.storage?.persisted?.().then(setPersisted)
  }, [])

  const requestPersist = async () => {
    const granted = await navigator.storage?.persist?.()
    setPersisted(granted ?? false)
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>{t('settingsLanguage')}</h2>
        <div className="row">
          {(['en', 'km'] as Language[]).map((code) => (
            <button
              key={code}
              className={lang === code ? 'primary' : ''}
              onClick={() => setLang(code)}
            >
              {code === 'en' ? 'English' : 'ភាសាខ្មែរ'}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{t('settingsModels')}</h2>
        <ModelCard
          label={t('settingsEmbedder')}
          model={status.embedder}
          onDownload={() => void ai.preload('embedder').catch(() => {})}
        />
        <ModelCard
          label={t('settingsGenerator')}
          model={status.generator}
          onDownload={() => void ai.preload('generator').catch(() => {})}
        />
      </section>

      <section className="card">
        <h2>{t('settingsStorage')}</h2>
        <p className="hint">
          {persisted ? t('settingsStoragePersisted') : t('settingsStorageNotPersisted')}
        </p>
        {persisted === false && (
          <button onClick={() => void requestPersist()}>{t('settingsStorageRequest')}</button>
        )}
      </section>

      <section className="card">
        <h2>{t('settingsStats')}</h2>
        <p className="hint">
          {stats
            ? `${stats.documents} ${t('settingsStatsDocs')} · ${stats.chunks} ${t('settingsStatsChunks')}`
            : '…'}
        </p>
      </section>

      <section className="card">
        <h2>{t('settingsDanger')}</h2>
        <button
          className="danger"
          onClick={() => {
            if (confirm(t('settingsWipeConfirm'))) {
              void wipeDatabase().then(() => getStats().then(setStats))
            }
          }}
        >
          {t('settingsWipe')}
        </button>
      </section>
    </div>
  )
}
