import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { deletePack, exportPack, importPack, listPacks, validatePack } from '../db/packs'
import type { PackRow } from '../types'

export function PacksView() {
  const { t } = useI18n()
  const [packs, setPacks] = useState<(PackRow & { document_count: number })[]>([])
  const [packName, setPackName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = () => {
    void listPacks().then(setPacks)
  }
  useEffect(refresh, [])

  const doExport = async () => {
    setBusy(true)
    setMessage('')
    try {
      const pack = await exportPack({ name: packName.trim() || 'My iAny knowledge' })
      const blob = new Blob([JSON.stringify(pack)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${pack.manifest.name.replace(/[^\p{L}\p{N}_-]+/gu, '-')}.iany.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setMessage(e instanceof Error && e.message === 'empty-library' ? t('packsEmptyLibrary') : t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      const pack = validatePack(JSON.parse(await file.text()))
      await importPack(pack)
      setMessage(t('packsImported'))
      refresh()
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      setMessage(
        code === 'pack-model-mismatch'
          ? t('packsModelMismatch')
          : code === 'pack-invalid-format'
            ? t('packsInvalid')
            : t('packsInvalid'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="packs">
      <section className="card">
        <h2>{t('packsTitle')}</h2>
        <input
          value={packName}
          onChange={(e) => setPackName(e.target.value)}
          placeholder={t('packsExportName')}
          disabled={busy}
        />
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => void doExport()}>
            {t('packsExport')}
          </button>
          <label className="filepick">
            {t('packsImport')}
            <input
              type="file"
              accept=".json,application/json"
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
      </section>

      <section>
        {packs.length === 0 && <p className="empty">{t('packsEmpty')}</p>}
        {packs.map((pack) => (
          <div key={pack.id} className="card doc">
            <div>
              <strong>📦 {pack.name}</strong>
              <p className="hint">
                {pack.document_count} {t('packsDocuments')}
                {pack.author ? ` · ${pack.author}` : ''}
              </p>
            </div>
            <button
              className="danger"
              onClick={() => {
                void deletePack(pack.id).then(refresh)
              }}
            >
              {t('packsDelete')}
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}
