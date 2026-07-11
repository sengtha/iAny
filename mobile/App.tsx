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
import { embedder, type EmbedderProgress } from './src/ai/embedder'
import { generator, type GenProgress } from './src/ai/generator'
import { ask } from './src/ai/ask'

/**
 * Stage 2 smoke-test screen: on-device SQLite + FTS5 (Stage 1) plus opt-in
 * semantic embeddings (multilingual-e5-small via llama.rn). Enabling
 * embeddings downloads the model once through the iAny mirror, then feed +
 * search use hybrid vector + keyword retrieval. Not the final UI — this
 * validates the pipeline.
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
  const [emb, setEmb] = useState<EmbedderProgress>({ status: embedder.status })
  const [gen, setGen] = useState<GenProgress>({ status: generator.status })
  const [answer, setAnswer] = useState('')

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

  // Pass the embedder only once it's loaded; otherwise retrieval/ingest run
  // FTS-only. Docs fed before enabling embeddings simply have no vectors.
  const activeEmbedder = () => (embedder.ready ? embedder : undefined)

  const onEnableEmbeddings = async () => {
    try {
      await embedder.init(setEmb)
    } catch {
      // status already reflected via setEmb('error')
    }
  }

  const onEnableGen = async () => {
    try {
      await generator.init(setGen)
    } catch {
      // status already reflected via setGen('error')
    }
  }

  const onAsk = async () => {
    if (!query.trim() || !generator.ready) return
    setBusy(true)
    setAnswer('')
    try {
      const res = await ask(query, activeEmbedder(), (t) => setAnswer((prev) => prev + t))
      setResults(res.sources)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onAdd = async () => {
    if (!content.trim()) return
    setBusy(true)
    try {
      await addDocument({ title: title.trim() || 'Untitled', content }, activeEmbedder())
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
      setResults(await hybridSearch(query, activeEmbedder(), 6))
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
          <Text style={styles.h1}>iAny · native (Stage 3)</Text>
          <Text style={styles.hint}>On-device search + AI answers, fully offline.</Text>

          <View style={styles.embBox}>
            {emb.status === 'ready' ? (
              <Text style={styles.embOn}>✓ Semantic search on — meaning + keywords</Text>
            ) : emb.status === 'downloading' ? (
              <Text style={styles.hint}>
                Downloading model… {Math.round((emb.progress ?? 0) * 100)}%
              </Text>
            ) : emb.status === 'loading' ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" />
                <Text style={styles.hint}>  Loading model…</Text>
              </View>
            ) : (
              <>
                <Pressable style={styles.btnOutline} onPress={onEnableEmbeddings}>
                  <Text style={styles.btnOutlineText}>Enable semantic search (~320 MB)</Text>
                </Pressable>
                {emb.status === 'error' && emb.error && (
                  <Text style={styles.errSmall}>⚠️ {emb.error}</Text>
                )}
              </>
            )}
          </View>

          <View style={styles.embBox}>
            {gen.status === 'ready' ? (
              <Text style={styles.embOn}>✓ AI answers on — Gemma 3 1B</Text>
            ) : gen.status === 'downloading' ? (
              <Text style={styles.hint}>
                Downloading Gemma… {Math.round((gen.progress ?? 0) * 100)}%
              </Text>
            ) : gen.status === 'loading' ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" />
                <Text style={styles.hint}>  Loading Gemma…</Text>
              </View>
            ) : (
              <>
                <Pressable style={styles.btnOutline} onPress={onEnableGen}>
                  <Text style={styles.btnOutlineText}>Enable AI answers (~800 MB)</Text>
                </Pressable>
                {gen.status === 'error' && gen.error && (
                  <Text style={styles.errSmall}>⚠️ {gen.error}</Text>
                )}
              </>
            )}
          </View>

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
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.flex1]} onPress={onSearch} disabled={busy}>
              <Text style={styles.btnText}>Search</Text>
            </Pressable>
            <View style={styles.gap} />
            <Pressable
              style={[styles.btn, styles.flex1, !gen.status || gen.status !== 'ready' ? styles.btnDim : null]}
              onPress={onAsk}
              disabled={busy || gen.status !== 'ready'}
            >
              <Text style={styles.btnText}>Ask AI</Text>
            </Pressable>
          </View>

          {(answer.length > 0 || (busy && gen.status === 'ready')) && (
            <View style={styles.answerCard}>
              <Text style={styles.answerLabel}>Answer</Text>
              <Text style={styles.answerText}>
                {answer || '…'}
              </Text>
            </View>
          )}

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
  errSmall: { color: '#dc2626', marginTop: 8, fontSize: 13 },
  embBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f5f7ff',
    borderWidth: 1,
    borderColor: '#e0e6ff',
  },
  embOn: { color: '#16a34a', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex1: { flex: 1 },
  gap: { width: 10 },
  btnDim: { backgroundColor: '#93b4f5' },
  answerCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 8,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  answerLabel: { fontWeight: '700', marginBottom: 6, color: '#15803d' },
  answerText: { color: '#14532d', fontSize: 15, lineHeight: 22 },
  btnOutline: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  btnOutlineText: { color: '#2563eb', fontWeight: '600' },
})
