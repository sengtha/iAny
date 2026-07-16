import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { addDocument, deleteDocument, listDocuments, type DocSummary } from '../db/database'
import { embedder, type EmbedderProgress } from '../ai/embedder'
import { pickAndReadDocuments } from '../lib/importFile'
import { C, shadow } from '../theme'

/**
 * Library — the knowledge base. Paste text to add a document; it's chunked and
 * (if semantic search is on) embedded for meaning-based retrieval. Lists all
 * documents with a delete action.
 */
export function LibraryScreen() {
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [emb, setEmb] = useState<EmbedderProgress>({ status: embedder.status })

  const refresh = () => {
    void listDocuments().then(setDocs)
  }
  useEffect(refresh, [])

  const activeEmbedder = () => (embedder.ready ? embedder : undefined)

  const enableSearch = async () => {
    try {
      await embedder.init(setEmb)
    } catch {
      /* status reflected via setEmb */
    }
  }

  const onAdd = async () => {
    if (!content.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await addDocument({ title: title.trim() || 'Untitled', content }, activeEmbedder())
      setTitle('')
      setContent('')
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onImportFile = async () => {
    if (busy) return
    setError('')
    try {
      const res = await pickAndReadDocuments()
      if (!res) return // cancelled
      setBusy(true)
      for (const doc of res.docs) {
        await addDocument({ title: doc.title, content: doc.content }, activeEmbedder())
      }
      refresh()
      const notes: string[] = []
      if (res.pdfUnavailable.length)
        notes.push('PDF import needs the full app build (not Expo Go).')
      if (res.skipped.length) notes.push(`Skipped (unsupported): ${res.skipped.join(', ')}`)
      if (notes.length) setError(notes.join('\n'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    await deleteDocument(id)
    refresh()
  }

  const embReady = emb.status === 'ready' || embedder.ready
  const embBusy = emb.status === 'downloading' || emb.status === 'loading'

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add to library</Text>
          <TextInput
            style={styles.input}
            placeholder="Title (optional)"
            placeholderTextColor={C.muted}
            value={title}
            onChangeText={setTitle}
            editable={!busy}
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Paste text (Khmer or English)…"
            placeholderTextColor={C.muted}
            value={content}
            onChangeText={setContent}
            multiline
            editable={!busy}
          />
          <View style={styles.btnRow}>
            <Pressable
              style={[styles.btn, styles.flex, (busy || !content.trim()) && styles.btnDim]}
              onPress={onAdd}
              disabled={busy || !content.trim()}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnText}>Add</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.btnOutline, busy && styles.btnDimOutline]}
              onPress={onImportFile}
              disabled={busy}
            >
              <Text style={styles.btnOutlineText}>📎 Import file</Text>
            </Pressable>
          </View>
          <Text style={styles.typesHint}>PDF, TXT, Markdown, HTML, CSV, JSON, RTF & more</Text>
          {error ? <Text style={styles.err}>⚠️ {error}</Text> : null}
        </View>

        {/* Semantic search toggle */}
        <View style={styles.searchRow}>
          {embReady ? (
            <Text style={styles.searchOn}>✓ Semantic search on</Text>
          ) : embBusy ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={styles.searchHint}>
                {'  '}
                {emb.status === 'downloading'
                  ? `Downloading… ${Math.round((emb.progress ?? 0) * 100)}%`
                  : 'Preparing…'}
              </Text>
            </View>
          ) : (
            <Pressable style={styles.searchBtn} onPress={enableSearch}>
              <Text style={styles.searchBtnText}>Enable semantic search (~320 MB)</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.sectionLabel}>Documents ({docs.length})</Text>
        {docs.length === 0 ? (
          <Text style={styles.emptyHint}>No documents yet. Paste some text above.</Text>
        ) : (
          docs.map((d) => (
            <View key={d.id} style={styles.doc}>
              <View style={styles.flex}>
                <Text style={styles.docTitle} numberOfLines={1}>
                  {d.title}
                </Text>
                <Text style={styles.docMeta}>
                  {d.lang} · {d.chunk_count} chunks
                </Text>
              </View>
              <Pressable onPress={() => onDelete(d.id)} hitSlop={8}>
                <Text style={styles.del}>Delete</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  body: { padding: 16, paddingBottom: 28 },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 16,
    ...shadow,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: C.text,
    backgroundColor: C.bg,
    marginBottom: 10,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  btn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDim: { backgroundColor: '#a5b4fc' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnRow: { flexDirection: 'row', gap: 8 },
  btnOutline: {
    borderWidth: 1,
    borderColor: C.accentBorder,
    backgroundColor: C.accentSoft,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDimOutline: { opacity: 0.5 },
  btnOutlineText: { color: C.accentText, fontWeight: '700', fontSize: 14 },
  typesHint: { color: C.muted, fontSize: 12, marginTop: 8 },
  err: { color: C.danger, fontSize: 13, marginTop: 10 },
  searchRow: { marginTop: 12, marginBottom: 4 },
  searchOn: { color: C.green, fontWeight: '700', fontSize: 13 },
  searchHint: { color: C.muted, fontSize: 13 },
  searchBtn: {
    borderWidth: 1,
    borderColor: C.accentBorder,
    backgroundColor: C.accentSoft,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  searchBtnText: { color: C.accentText, fontWeight: '700', fontSize: 13.5 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: C.muted,
    letterSpacing: 0.4,
    marginTop: 20,
    marginBottom: 10,
  },
  emptyHint: { color: C.muted, fontSize: 14, paddingVertical: 8 },
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  docTitle: { fontWeight: '600', color: C.text, fontSize: 15 },
  docMeta: { color: C.muted, fontSize: 12, marginTop: 2 },
  del: { color: C.danger, fontWeight: '600', fontSize: 14 },
})
