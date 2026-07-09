import { useEffect, useState } from 'react'
import { ai, getGenModelChoice, setGenModelChoice } from '../ai/client'
import { useModelStatus } from '../hooks/useModelStatus'
import { useI18n } from '../i18n'
import { getStats, wipeDatabase, type DbStats } from '../db/documents'
import {
  backupNow,
  generateRecoveryCode,
  getBackupInfo,
  getStoredCode,
  normalizeCode,
  restoreBackup,
  storeCode,
} from '../lib/backup'
import { runDiagnostics, type DiagnosticResult } from '../lib/diagnostics'
import {
  exportModelBundle,
  formatBytes,
  getCachedModelInfo,
  importModelBundle,
  type ModelBundleInfo,
} from '../lib/modelShare'
import {
  COMPACT_GENERATION_MODEL_ID,
  EMBEDDING_MODEL_ID,
  GENERATION_MODEL_ID,
  MODEL_MIN_COMPLETE_BYTES,
  type Language,
  type ModelProgress,
} from '../types'

function ModelCard({ label, model, onDownload }: {
  label: string
  model: ModelProgress
  onDownload: () => void
}) {
  const { t } = useI18n()
  const statusText = {
    idle: t('settingsModelIdle'),
    cached: t('settingsModelCached'),
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
        {model.status === 'error' && model.error && (
          <p className="hint error-detail">{model.error.slice(0, 400)}</p>
        )}
      </div>
      {(model.status === 'idle' || model.status === 'error') && (
        <button className="primary" onClick={onDownload}>
          {model.status === 'error' ? t('settingsRetry') : t('settingsDownload')}
        </button>
      )}
    </div>
  )
}

function ModelShare() {
  const { t } = useI18n()
  const models = [
    { id: EMBEDDING_MODEL_ID, name: 'EmbeddingGemma' },
    { id: GENERATION_MODEL_ID, name: 'Gemma 4 E2B' },
    { id: COMPACT_GENERATION_MODEL_ID, name: 'Gemma 3 1B' },
  ]
  const [cached, setCached] = useState<Record<string, ModelBundleInfo | null>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = () => {
    for (const m of models) {
      void getCachedModelInfo(m.id).then((info) => setCached((c) => ({ ...c, [m.id]: info })))
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [])

  const doExport = async (id: string, name: string) => {
    setBusy(true)
    setMessage('')
    try {
      const blob = await exportModelBundle(id)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${name.replace(/\s+/g, '-')}.iany-model`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      setMessage(t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const result = await importModelBundle(file)
      setMessage(`${t('modelShareImported')} (${result.model}, ${result.files})`)
      refresh()
      void ai.refreshCachedStatus()
    } catch {
      setMessage(t('modelShareInvalid'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="model-share">
      <p className="hint">{t('modelShareHint')}</p>
      <div className="row">
        {models.map(
          (m) =>
            cached[m.id] &&
            // Don't offer exporting an incomplete download — the bundle
            // would be missing weights and useless on the other device.
            cached[m.id]!.bytes >= (MODEL_MIN_COMPLETE_BYTES[m.id] ?? 0) && (
              <button key={m.id} disabled={busy} onClick={() => void doExport(m.id, m.name)}>
                {t('modelShareExport')} {m.name} ({formatBytes(cached[m.id]!.bytes)})
              </button>
            ),
        )}
        <label className="filepick">
          {t('modelShareImport')}
          <input
            type="file"
            accept=".iany-model"
            hidden
            disabled={busy}
            onChange={(e) => {
              void doImport(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  )
}

function CloudBackup() {
  const { t } = useI18n()
  const [code, setCode] = useState<string | null>(getStoredCode)
  const [revealed, setRevealed] = useState(false)
  const [restoreInput, setRestoreInput] = useState('')
  const [lastBackup, setLastBackup] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (code) {
      void getBackupInfo(code)
        .then((info) => setLastBackup(info.uploadedAt ?? null))
        .catch(() => {})
    }
  }, [code])

  const enable = () => {
    const fresh = generateRecoveryCode()
    storeCode(fresh)
    setCode(fresh)
    setRevealed(true)
  }

  const doBackup = async () => {
    if (!code) return
    setBusy(true)
    setMessage('')
    try {
      await backupNow(code)
      setLastBackup(new Date().toISOString())
      setMessage(t('backupDone'))
    } catch (e) {
      setMessage(
        e instanceof Error && e.message === 'empty-library' ? t('packsEmptyLibrary') : t('errorGeneric'),
      )
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async () => {
    const entered = normalizeCode(restoreInput)
    if (!entered) return
    setBusy(true)
    setMessage('')
    try {
      await restoreBackup(entered)
      storeCode(entered)
      setCode(entered)
      setRestoreInput('')
      setMessage(t('backupRestored'))
    } catch (e) {
      const err = e instanceof Error ? e.message : ''
      setMessage(
        err === 'backup-not-found'
          ? t('backupNotFound')
          : err === 'backup-decrypt-failed'
            ? t('backupNotFound')
            : t('errorGeneric'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>{t('backupTitle')}</h2>
      <p>{t('backupBody')}</p>
      {!code && (
        <button className="primary" onClick={enable}>
          {t('backupEnable')}
        </button>
      )}
      {code && (
        <>
          <p className="hint">{t('backupCodeLabel')}</p>
          <div className="row">
            <code className="recovery-code">{revealed ? code : '••••-••••-••••-••••-••••'}</code>
            <button onClick={() => setRevealed((r) => !r)}>{revealed ? '🙈' : '👁️'}</button>
            <button onClick={() => void navigator.clipboard?.writeText(code)}>📋</button>
          </div>
          <p className="hint error">{t('backupCodeWarning')}</p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => void doBackup()}>
              {t('backupNow')}
            </button>
            {lastBackup && (
              <span className="hint">
                {t('backupLast')} {new Date(lastBackup).toLocaleString()}
              </span>
            )}
          </div>
        </>
      )}
      <div className="restore">
        <p className="hint">{t('backupRestoreHint')}</p>
        <div className="row">
          <input
            value={restoreInput}
            onChange={(e) => setRestoreInput(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
            className="restore-input"
          />
          <button disabled={busy || !restoreInput.trim()} onClick={() => void doRestore()}>
            {t('backupRestore')}
          </button>
        </div>
      </div>
      {message && <p className="hint">{message}</p>}
    </section>
  )
}

function Diagnostics() {
  const { t } = useI18n()
  const [results, setResults] = useState<DiagnosticResult[] | null>(null)
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setResults(await runDiagnostics())
    setRunning(false)
  }

  return (
    <div className="diagnostics">
      <button disabled={running} onClick={() => void run()}>
        {t('settingsDiagnose')}
      </button>
      {results && (
        <ul className="diag-list">
          {results.map((r) => (
            <li key={r.name} className={r.ok ? 'ok' : 'fail'}>
              {r.ok ? '✅' : '❌'} {r.name} — {r.detail}
            </li>
          ))}
        </ul>
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
          label={
            getGenModelChoice() === 'compact'
              ? t('settingsGeneratorCompact')
              : t('settingsGenerator')
          }
          model={status.generator}
          onDownload={() => void ai.preload('generator').catch(() => {})}
        />
        <p className="hint">{t('settingsGenChoiceLabel')}</p>
        <div className="row">
          <button
            className={getGenModelChoice() === 'compact' ? 'primary' : ''}
            onClick={() => getGenModelChoice() !== 'compact' && setGenModelChoice('compact')}
          >
            {t('settingsGenCompact')}
          </button>
          <button
            className={getGenModelChoice() === 'full' ? 'primary' : ''}
            onClick={() => getGenModelChoice() !== 'full' && setGenModelChoice('full')}
          >
            {t('settingsGenFull')}
          </button>
        </div>
        <ModelShare />
        <Diagnostics />
      </section>

      <CloudBackup />

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
