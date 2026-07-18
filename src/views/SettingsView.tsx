import { useEffect, useState } from 'react'
import { ai, getCrashSuspect, getGenModelChoice, setGenModelChoice } from '../ai/client'
import { useModelStatus } from '../hooks/useModelStatus'
import { useI18n } from '../i18n'
import { resetDatabase } from '../db/client'
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
import { khmerTts, type VoiceProgress } from '../ai/khmertts'
import { khmerStt, sttSupported, type SttState } from '../ai/khmerStt'
import {
  clearHandModel,
  downloadHandModel,
  isHandModelDownloaded,
  isHandTrackingSupported as handTrackingSupported,
} from '../ai/handModel'
import {
  deleteModelCache,
  exportModelBundle,
  formatBytes,
  getCachedModelInfo,
  importModelBundle,
  type ModelBundleInfo,
} from '../lib/modelShare'
import {
  EMBEDDING_MODEL_ID,
  GEN_MODELS,
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
    loading: model.network ? t('settingsModelLoading') : t('modelPreparing'),
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
    ...GEN_MODELS.map((m) => ({ id: m.id, name: m.name })),
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
      {models.map((m) => {
        const info = cached[m.id]
        if (!info) return null
        const complete = info.bytes >= (MODEL_MIN_COMPLETE_BYTES[m.id] ?? 0)
        return (
          <div key={m.id} className="row model-row">
            <span className="hint">
              {m.name} — {formatBytes(info.bytes)}
            </span>
            {/* Don't offer exporting an incomplete download — the bundle
                would be missing weights and useless on the other device. */}
            {complete && (
              <button disabled={busy} onClick={() => void doExport(m.id, m.name)}>
                {t('modelShareExport')}
              </button>
            )}
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                void deleteModelCache(m.id).then(refresh)
              }}
            >
              {t('modelShareDelete')}
            </button>
          </div>
        )
      })}
      <div className="row">
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

/** The trained iAny Khmer voice (ONNX) — download once, then the Radio reads
 *  news with it. ~115 MB, cached for offline use. */
function VoiceCard() {
  const { t } = useI18n()
  const [voice, setVoice] = useState<VoiceProgress>({ status: khmerTts.status })
  const [cached, setCached] = useState(false)

  useEffect(() => {
    void khmerTts.isDownloaded().then(setCached)
  }, [])

  const download = () => {
    void khmerTts
      .init(setVoice)
      .then(() => setCached(true))
      .catch(() => {})
  }

  const ready = voice.status === 'ready' || khmerTts.ready
  const busy = voice.status === 'downloading' || voice.status === 'loading'
  const statusText =
    voice.status === 'downloading'
      ? `${t('settingsModelLoading')} ${Math.round((voice.progress ?? 0) * 100)}%`
      : voice.status === 'loading'
        ? t('modelPreparing')
        : ready
          ? t('settingsModelReady')
          : cached
            ? t('settingsModelCached')
            : voice.status === 'error'
              ? (voice.error ?? t('settingsModelError'))
              : t('settingsVoiceNote')

  return (
    <div className="card doc model">
      <div>
        <strong>{t('settingsVoice')}</strong>
        <p className="hint">{statusText}</p>
        {voice.status === 'downloading' && <progress value={voice.progress} max={1} />}
      </div>
      {!ready && !cached && !busy && (
        <button className="primary" onClick={download}>
          {t('settingsDownload')}
        </button>
      )}
    </div>
  )
}

/** Khmer voice input (STT, ONNX via transformers.js/WASM) — download once for
 *  offline speech-to-text in Chat. Desktop/tablet only (~150 MB). */
function SttCard() {
  const { t } = useI18n()
  const [state, setState] = useState<SttState>({ phase: 'idle', level: 0 })
  const [cached, setCached] = useState(() => khmerStt.isDownloaded())

  useEffect(() => khmerStt.subscribe(setState), [])

  const download = () => {
    void khmerStt
      .download()
      .then(() => setCached(true))
      .catch(() => {})
  }
  const redownload = () => {
    void khmerStt.clearCache().then(() => {
      setCached(false)
      download()
    })
  }

  const busy = state.phase === 'loading' || state.phase === 'transcribing'
  const statusText =
    state.phase === 'loading'
      ? `${t('settingsModelLoading')}${
          state.download != null ? ` ${Math.round(state.download * 100)}%` : ''
        }`
      : state.phase === 'error'
        ? (state.error ?? t('settingsModelError'))
        : cached
          ? t('settingsModelReady')
          : t('settingsSttNote')

  return (
    <div className="card doc model">
      <div>
        <strong>{t('settingsStt')}</strong>
        <p className="hint">{statusText}</p>
        {state.phase === 'loading' && state.download != null && (
          <progress value={state.download} max={1} />
        )}
      </div>
      {!busy &&
        (cached ? (
          <button onClick={redownload}>{t('settingsRedownload')}</button>
        ) : (
          <button className="primary" onClick={download}>
            {t('settingsDownload')}
          </button>
        ))}
    </div>
  )
}

/** Pre-download the MediaPipe hand model that powers the /sign collector. */
function HandModelCard() {
  const { t } = useI18n()
  const [cached, setCached] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void isHandModelDownloaded().then(setCached)
  }, [])

  const download = async () => {
    setError('')
    setProgress(0)
    try {
      await downloadHandModel((f) => setProgress(f))
      setCached(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settingsModelError'))
    } finally {
      setProgress(null)
    }
  }
  const redownload = async () => {
    await clearHandModel()
    setCached(false)
    void download()
  }

  const busy = progress != null
  const statusText = busy
    ? `${t('settingsModelLoading')}${progress != null ? ` ${Math.round(progress * 100)}%` : ''}`
    : error
      ? error
      : cached
        ? t('settingsModelReady')
        : t('settingsSignNote')

  return (
    <div className="card doc model">
      <div>
        <strong>{t('settingsSign')}</strong>
        <p className="hint">{statusText}</p>
        {busy && progress != null && <progress value={progress} max={1} />}
      </div>
      {!busy &&
        (cached ? (
          <button onClick={() => void redownload()}>{t('settingsRedownload')}</button>
        ) : (
          <button className="primary" onClick={() => void download()}>
            {t('settingsDownload')}
          </button>
        ))}
    </div>
  )
}

export function SettingsView() {
  const { t, lang, setLang } = useI18n()
  const status = useModelStatus()
  const [stats, setStats] = useState<DbStats | null>(null)
  const [dbError, setDbError] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch((e) => setDbError(e instanceof Error ? e.message : String(e)))
    void navigator.storage?.persisted?.().then(setPersisted)
    void navigator.storage
      ?.estimate?.()
      .then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }))
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

        {/* Semantic search (the embedder) — always used for retrieval. */}
        <ModelCard
          label={t('settingsEmbedder')}
          model={status.embedder}
          onDownload={() => void ai.preload('embedder').catch(() => {})}
        />

        {/* Answering model — pick one. iAny Khmer is the small default. */}
        <p className="hint model-group">{t('settingsGenChoiceLabel')}</p>
        {GEN_MODELS.map((m) => {
          const active = getGenModelChoice() === m.choice
          const g = status.generator
          const note = {
            khmer: t('settingsGenKhmer'),
            tiny: t('settingsGenTiny'),
            small: t('settingsGenSmall'),
            compact: t('settingsGenCompact'),
            full: t('settingsGenFull'),
            max: t('settingsGenMax'),
          }[m.choice]
          return (
            <div key={m.choice} className="card doc model">
              <div>
                <strong>
                  {m.name}
                  {active ? (
                    <span className="badge inuse"> ● {t('settingsInUse')}</span>
                  ) : m.choice === 'khmer' ? (
                    <span className="badge reco"> {t('settingsRecommended')}</span>
                  ) : null}
                </strong>
                <p className="hint">{note}</p>
                {active && g.status === 'loading' && <progress value={g.progress} max={1} />}
              </div>
              {active ? (
                g.status === 'idle' || g.status === 'error' ? (
                  <button
                    className="primary"
                    onClick={() => void ai.preload('generator').catch(() => {})}
                  >
                    {g.status === 'error' ? t('settingsRetry') : t('settingsDownload')}
                  </button>
                ) : g.status === 'ready' || g.status === 'cached' ? (
                  <span className="badge ready">✓</span>
                ) : null
              ) : (
                <button onClick={() => setGenModelChoice(m.choice)}>{t('settingsUse')}</button>
              )}
            </div>
          )
        })}
        {getCrashSuspect() !== null && <p className="error">{t('genCrashWarning')}</p>}

        {/* Khmer voice (ONNX) — reads the Radio news aloud. */}
        <p className="hint model-group">{t('settingsVoiceLabel')}</p>
        <VoiceCard />

        {/* Khmer voice input (STT) — desktop/tablet only. */}
        {sttSupported() && (
          <>
            <p className="hint model-group">{t('settingsSttLabel')}</p>
            <SttCard />
          </>
        )}

        {/* Khmer Sign Language (/sign) — pre-download the hand tracker. */}
        {handTrackingSupported() && (
          <>
            <p className="hint model-group">{t('settingsSignLabel')}</p>
            <HandModelCard />
          </>
        )}

        <details className="advanced">
          <summary>{t('settingsAdvanced')}</summary>
          <ModelShare />
          <Diagnostics />
        </details>
      </section>

      <CloudBackup />

      <section className="card">
        <h2>{t('settingsStorage')}</h2>
        {usage && usage.quota > 0 && (
          <>
            <p className="hint">
              {t('settingsStorageUsed')}: {formatBytes(usage.used)} / {formatBytes(usage.quota)}
            </p>
            <progress value={usage.used} max={usage.quota} />
          </>
        )}
        <p className="hint">
          {persisted ? t('settingsStoragePersisted') : t('settingsStorageNotPersisted')}
        </p>
        {persisted === false && (
          <button onClick={() => void requestPersist()}>{t('settingsStorageRequest')}</button>
        )}
      </section>

      <section className="card">
        <h2>{t('settingsStats')}</h2>
        {!dbError && (
          <p className="hint">
            {stats
              ? `${stats.documents} ${t('settingsStatsDocs')} · ${stats.chunks} ${t('settingsStatsChunks')}`
              : '…'}
          </p>
        )}
        {dbError && (
          <>
            <p className="error">{t('settingsDbBroken')}</p>
            <p className="hint error-detail">{dbError.slice(0, 200)}</p>
            <button
              className="danger"
              onClick={() => {
                if (confirm(t('settingsDbResetConfirm'))) void resetDatabase()
              }}
            >
              {t('settingsDbReset')}
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2>{t('settingsCredits')}</h2>
        <ul className="credits">
          <li>
            Khmer voice — <strong>DDD-Cambodia</strong> corpus (CC-BY-SA-4.0) · VITS / Coqui TTS
          </li>
          <li>
            Khmer OCR — <strong>seanghay/KhmerOCR</strong> (MIT)
          </li>
          <li>
            Sign Language — <strong>MediaPipe Hand Landmarker</strong> (Apache-2.0, Google)
          </li>
          <li>
            Answering — <strong>Qwen3-0.6B</strong> (Apache-2.0), Gemma (Google)
          </li>
          <li>
            Semantic search — <strong>EmbeddingGemma</strong> (Google)
          </li>
          <li>
            All open Khmer models —{' '}
            <a href="https://huggingface.co/sengtha" target="_blank" rel="noreferrer">
              huggingface.co/sengtha
            </a>
          </li>
        </ul>
      </section>

      <p className="hint build-id">iAny · build {__BUILD_ID__}</p>

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
