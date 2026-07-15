import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  MODELS,
  downloadModel,
  formatBytes,
  getActiveGenId,
  importModel,
  modelState,
  removeModel,
  setActiveGenId,
  shareModel,
  totalModelStorage,
  type ManagedModel,
  type ModelState,
} from './models/manager'
import { generator } from './ai/generator'
import { embedder } from './ai/embedder'
import { tts } from './ai/tts'

/**
 * Models screen: choose the LLM quant, and download / redownload / delete /
 * SHARE / import each model (LLM, semantic search, voice). Sharing hands the
 * file to the OS sheet (Bluetooth / Nearby / Quick Share) so a second phone can
 * receive it and Import it — no re-download.
 */
export function ModelsScreen({ onClose }: { onClose: () => void }) {
  const [states, setStates] = useState<Record<string, ModelState>>({})
  const [activeGen, setActiveGen] = useState('')
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  const refresh = useCallback(async () => {
    const entries = await Promise.all(MODELS.map(async (m) => [m.id, await modelState(m)] as const))
    setStates(Object.fromEntries(entries))
    setActiveGen(await getActiveGenId())
    setTotal(await totalModelStorage())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try {
      await fn()
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setProgress((p) => ({ ...p, [id]: 0 }))
      void refresh()
    }
  }

  const onDownload = (m: ManagedModel) =>
    run(m.id, () => downloadModel(m, (f) => setProgress((p) => ({ ...p, [m.id]: f }))))

  const onRedownload = (m: ManagedModel) =>
    run(m.id, async () => {
      await releaseForKind(m)
      await removeModel(m)
      await downloadModel(m, (f) => setProgress((p) => ({ ...p, [m.id]: f })))
    })

  const onDelete = (m: ManagedModel) =>
    run(m.id, async () => {
      await releaseForKind(m)
      await removeModel(m)
    })

  const onShare = (m: ManagedModel) =>
    run(m.id, async () => {
      const ok = await shareModel(m)
      if (!ok) Alert.alert('Not available', 'Download it first, then share.')
    })

  const onImport = (m: ManagedModel) =>
    run(m.id, async () => {
      const ok = await importModel(m)
      if (ok) Alert.alert('Imported', `${m.label} is ready — no download needed.`)
    })

  const onUse = (m: ManagedModel) =>
    run(m.id, async () => {
      await setActiveGenId(m.id)
      await generator.release() // reload with the newly-selected model on next use
    })

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>⚙ Models</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Download once, then Share phone-to-phone (Bluetooth / Nearby) so others skip the download.
        {total > 0 ? `  ·  ${formatBytes(total)} on device` : ''}
      </Text>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {MODELS.map((m) => {
          const st = states[m.id]
          const isActive = m.kind === 'generation' && activeGen === m.id
          const isBusy = busy === m.id
          const prog = progress[m.id] ?? 0
          return (
            <View key={m.id} style={styles.row}>
              <View style={styles.rowHead}>
                <Text style={styles.label}>
                  {m.label} {isActive ? <Text style={styles.badge}>● in use</Text> : null}
                </Text>
                <Text style={styles.size}>
                  {st?.downloaded ? formatBytes(st.sizeBytes) : 'not downloaded'}
                </Text>
              </View>
              <Text style={styles.note}>{m.note}</Text>

              {isBusy ? (
                <View style={styles.progRow}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.note}>
                    {prog > 0 ? `  ${Math.round(prog * 100)}%` : '  working…'}
                  </Text>
                </View>
              ) : (
                <View style={styles.actions}>
                  {m.selectable && st?.downloaded && !isActive ? (
                    <Btn label="Use" primary onPress={() => onUse(m)} />
                  ) : null}
                  {st?.downloaded ? (
                    <>
                      <Btn label="↻ Redownload" onPress={() => onRedownload(m)} />
                      <Btn label="Share" onPress={() => onShare(m)} />
                      <Btn label="Delete" danger onPress={() => onDelete(m)} />
                    </>
                  ) : (
                    <>
                      <Btn label="Download" primary onPress={() => onDownload(m)} />
                      <Btn label="Import" onPress={() => onImport(m)} />
                    </>
                  )}
                </View>
              )}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )

  // Release the in-memory model of the affected kind so a delete/redownload
  // takes effect and the file isn't held open.
  async function releaseForKind(m: ManagedModel): Promise<void> {
    if (m.kind === 'generation') await generator.release()
    else if (m.kind === 'voice') await tts.reset()
    else if (m.kind === 'embedding') await embedder.release?.()
  }
}

function Btn({
  label,
  onPress,
  primary,
  danger,
}: {
  label: string
  onPress: () => void
  primary?: boolean
  danger?: boolean
}) {
  return (
    <Pressable
      style={[styles.btn, primary && styles.primary, danger && styles.danger]}
      onPress={onPress}
    >
      <Text style={[styles.btnText, (primary || danger) && styles.btnTextLight]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#3730a3' },
  close: { fontSize: 16, color: '#6366f1', fontWeight: '600' },
  hint: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 8 },
  list: { flex: 1 },
  listContent: { paddingBottom: 16 },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  badge: { fontSize: 12, color: '#16a34a', fontWeight: '700' },
  size: { fontSize: 12, color: '#64748b' },
  note: { fontSize: 12, color: '#64748b', marginTop: 2 },
  progRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  btn: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  primary: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  danger: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  btnText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  btnTextLight: { color: '#fff' },
})
