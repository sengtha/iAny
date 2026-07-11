import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import {
  addDocument,
  deleteDocument,
  getDb,
  hybridSearch,
  listDocuments,
  type DocSummary,
} from './src/db/database'
import type { ChunkHit } from './src/domain/types'

/**
 * Stage 1 smoke-test screen: prove that on-device SQLite ingest + FTS5
 * (trigram, Khmer-safe) retrieval works end-to-end on the phone. No models
 * yet — vector search and generation arrive in Stage 2/3. This screen exists
 * to validate the storage foundation, not as the final UI.
 */
export default function App() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChunkHit[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        await getDb()
        setDocs(await listDocuments())
        setReady(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const refresh = async () => setDocs(await listDocuments())

  const onAdd = async () => {
    if (!content.trim()) return
    setBusy(true)
    try {
      await addDocument({ title: title.trim() || 'Untitled', content })
      setTitle('')
      setContent('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onSearch = async () => {
    if (!query.trim()) return
    setBusy(true)
    try {
      // No embedder in Stage 1 → FTS-only retrieval.
      setResults(await hybridSearch(query, undefined, 6))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    await deleteDocument(id)
    await refresh()
  }

  if (error) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.center}>
          <Text style={styles.err}>⚠️ {error}</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    )
  }
  if (!ready) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.center}>
          <ActivityIndicator />
        </SafeAreaView>
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="auto" />
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.h1}>iAny · native (Stage 1)</Text>
          <Text style={styles.hint}>On-device SQLite + FTS5. Feed text, then search it.</Text>

          <Text style={styles.label}>Feed</Text>
          <TextInput
            style={styles.input}
            placeholder="Title"
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Paste text (Khmer or English)…"
            value={content}
            onChangeText={setContent}
            multiline
          />
          <Pressable style={styles.btn} onPress={onAdd} disabled={busy}>
            <Text style={styles.btnText}>Add to knowledge base</Text>
          </Pressable>

          <Text style={styles.label}>Search</Text>
          <TextInput
            style={styles.input}
            placeholder="Ask / search…"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={onSearch}
          />
          <Pressable style={styles.btn} onPress={onSearch} disabled={busy}>
            <Text style={styles.btnText}>Search</Text>
          </Pressable>

          {busy && <ActivityIndicator style={{ marginTop: 12 }} />}

          {results.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.label}>Results</Text>
              {results.map((r) => (
                <View key={r.chunk_id} style={styles.card}>
                  <Text style={styles.cardTitle}>{r.title}</Text>
                  <Text style={styles.cardText}>{r.text}</Text>
                  <Text style={styles.score}>score {r.score.toFixed(4)}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.label}>Library ({docs.length})</Text>
            <FlatList
              scrollEnabled={false}
              data={docs}
              keyExtractor={(d) => d.id}
              renderItem={({ item }) => (
                <View style={styles.docRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docTitle}>{item.title}</Text>
                    <Text style={styles.docMeta}>
                      {item.lang} · {item.chunk_count} chunks
                    </Text>
                  </View>
                  <Pressable onPress={() => onDelete(item.id)}>
                    <Text style={styles.delete}>Delete</Text>
                  </Pressable>
                </View>
              )}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  body: { padding: 16, gap: 8 },
  h1: { fontSize: 22, fontWeight: '700' },
  hint: { color: '#666', marginBottom: 8 },
  label: { fontWeight: '600', marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#fafafa',
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  btn: { backgroundColor: '#2563eb', borderRadius: 8, padding: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
  section: { marginTop: 8 },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, padding: 12, marginTop: 8 },
  cardTitle: { fontWeight: '600', marginBottom: 4 },
  cardText: { color: '#333' },
  score: { color: '#999', fontSize: 12, marginTop: 6 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    paddingVertical: 10,
  },
  docTitle: { fontWeight: '500' },
  docMeta: { color: '#888', fontSize: 12 },
  delete: { color: '#dc2626', fontWeight: '500' },
  err: { color: '#dc2626', padding: 24, textAlign: 'center' },
})
