import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { deletePack, listPacks, type PackSummary } from './db/database'
import { exportAndSharePack, importPackFromFile } from './packs/packs'

/**
 * 📦 Knowledge packs — share your knowledge base phone-to-phone. Export bundles
 * every note + its embeddings into one file and opens the OS share sheet
 * (Bluetooth / Nearby / Quick Share); Import loads a received pack. Same
 * iany-pack/1 format as the PWA.
 */
export function PacksScreen({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState('My knowledge')
  const [packs, setPacks] = useState<PackSummary[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setPacks(await listPacks())
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const onExport = async () => {
    setBusy('export')
    try {
      const r = await exportAndSharePack(name)
      if (!r.shared) Alert.alert('Saved', 'Sharing not available on this device.')
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const onImport = async () => {
    setBusy('import')
    try {
      const r = await importPackFromFile()
      if (r) {
        const warn = r.warnings.length ? `\n\nNote:\n• ${r.warnings.join('\n• ')}` : ''
        Alert.alert('Imported', `"${r.name}" · ${r.documents} documents added.${warn}`)
        await refresh()
        onChanged()
      }
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const onDelete = (p: PackSummary) =>
    Alert.alert('Delete pack?', `Remove "${p.name}" and its ${p.doc_count} documents?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deletePack(p.id)
          await refresh()
          onChanged()
        },
      },
    ])

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>📦 Knowledge packs</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Bundle your notes (with embeddings) into one file and share it phone-to-phone — the other
        device imports it, no re-typing, no internet.
      </Text>

      <Text style={styles.label}>Pack name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="My knowledge" />

      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, styles.primary]}
          onPress={onExport}
          disabled={busy != null}
        >
          <Text style={styles.btnTextLight}>
            {busy === 'export' ? 'Preparing…' : '📤 Export & Share'}
          </Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={onImport} disabled={busy != null}>
          <Text style={styles.btnText}>{busy === 'import' ? 'Importing…' : '📥 Import pack'}</Text>
        </Pressable>
      </View>

      {busy ? <ActivityIndicator style={{ marginTop: 10 }} /> : null}

      {packs.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.listTitle}>Imported packs</Text>
          {packs.map((p) => (
            <View key={p.id} style={styles.packRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.packName}>{p.name}</Text>
                <Text style={styles.packMeta}>
                  {p.doc_count} docs{p.author ? ` · ${p.author}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => onDelete(p)} hitSlop={8}>
                <Text style={styles.del}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#166534' },
  close: { fontSize: 16, color: '#16a34a', fontWeight: '600' },
  hint: { fontSize: 12, color: '#4b5563', marginTop: 4, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    backgroundColor: '#fff',
    color: '#0f172a',
  },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#fff',
  },
  primary: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  btnText: { color: '#166534', fontWeight: '600', fontSize: 13 },
  btnTextLight: { color: '#fff', fontWeight: '700', fontSize: 13 },
  list: { marginTop: 14 },
  listTitle: { fontSize: 12, fontWeight: '700', color: '#166534', marginBottom: 4 },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#dcfce7',
  },
  packName: { fontSize: 14, fontWeight: '600', color: '#14532d' },
  packMeta: { fontSize: 12, color: '#4b5563' },
  del: { color: '#dc2626', fontWeight: '600', fontSize: 13 },
})
