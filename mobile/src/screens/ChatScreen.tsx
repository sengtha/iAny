import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Audio } from 'expo-av'
import { embedder } from '../ai/embedder'
import { generator, type GenProgress } from '../ai/generator'
import { ask } from '../ai/ask'
import { stt, type SttProgress } from '../ai/stt'
import type { ChunkHit } from '../domain/types'
import { C, shadow } from '../theme'

/**
 * Chat — ask a question, get a grounded Khmer answer. Loads the answer model on
 * first use (progress shown), streams the reply, and lists the sources it used.
 */
export function ChatScreen() {
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<ChunkHit[]>([])
  const [speed, setSpeed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [gen, setGen] = useState<GenProgress>({ status: generator.status })
  const [listening, setListening] = useState(false)
  const [sttProg, setSttProg] = useState<SttProgress>({ status: 'idle' })
  const sttSession = useRef<Awaited<ReturnType<typeof stt.listen>> | null>(null)
  const scroll = useRef<ScrollView>(null)

  const genReady = gen.status === 'ready' || generator.ready
  const activeEmbedder = () => (embedder.ready ? embedder : undefined)

  const loadModel = async () => {
    try {
      await generator.init(setGen)
    } catch {
      /* status reflected via setGen('error') */
    }
  }

  const onAsk = async () => {
    const q = query.trim()
    if (!q || busy) return
    if (!generator.ready) {
      await loadModel()
      if (!generator.ready) return
    }
    setBusy(true)
    setAnswer('')
    setSources([])
    setSpeed(null)
    const t0 = Date.now()
    let firstAt = 0
    let tokens = 0
    try {
      let raw = ''
      const res = await ask(q, activeEmbedder(), (t) => {
        if (!firstAt) firstAt = Date.now()
        tokens++
        raw += t
        const shown = raw
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .replace(/<think>[\s\S]*$/, '')
          .replace(/^\s+/, '')
        setAnswer(shown)
        scroll.current?.scrollToEnd({ animated: true })
      })
      const end = Date.now()
      if (tokens > 0 && firstAt > 0) {
        const tps = (tokens / Math.max((end - firstAt) / 1000, 0.001)).toFixed(1)
        const ttft = ((firstAt - t0) / 1000).toFixed(1)
        setSpeed(`⚡ ${tokens} tokens · ${tps} tok/s · first token ${ttft}s`)
      }
      setSources(res.sources)
    } catch (e) {
      setAnswer(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  // Voice input: tap to record, tap again to stop. Partial transcription fills
  // the composer live; the final text stays there for the user to review/send.
  const toggleMic = async () => {
    if (listening) {
      const session = sttSession.current
      sttSession.current = null
      setListening(false)
      try {
        const text = (await session?.stop()) ?? ''
        if (text) setQuery(text)
      } catch {
        /* ignore */
      }
      return
    }
    const perm = await Audio.requestPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Microphone needed', 'Allow microphone access to speak your question.')
      return
    }
    setListening(true)
    setQuery('')
    try {
      sttSession.current = await stt.listen(
        (partial) => setQuery(partial),
        (p) => setSttProg(p),
      )
    } catch (e) {
      setListening(false)
      setSttProg({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  const sttStatusText =
    sttProg.status === 'downloading'
      ? `Downloading voice input… ${Math.round((sttProg.progress ?? 0) * 100)}%`
      : sttProg.status === 'loading'
        ? 'Preparing voice input…'
        : listening
          ? '🎙️ Listening… tap the mic to stop'
          : sttProg.status === 'error'
            ? `⚠️ Voice input: ${sttProg.error ?? 'failed'}`
            : ''

  const empty = !answer && !busy

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {!genReady && gen.status !== 'downloading' && gen.status !== 'loading' ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              The AI answer model isn't loaded yet. It downloads once (~300 MB), then works
              offline.
            </Text>
            <Pressable style={styles.noticeBtn} onPress={loadModel}>
              <Text style={styles.noticeBtnText}>
                {gen.status === 'error' ? 'Retry' : 'Load AI model'}
              </Text>
            </Pressable>
            {gen.status === 'error' && gen.error ? (
              <Text style={styles.err}>⚠️ {gen.error}</Text>
            ) : null}
          </View>
        ) : null}
        {gen.status === 'downloading' || gen.status === 'loading' ? (
          <View style={styles.notice}>
            <View style={styles.row}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={styles.noticeText}>
                {'  '}
                {gen.status === 'downloading'
                  ? `Downloading model… ${Math.round((gen.progress ?? 0) * 100)}%`
                  : 'Preparing model…'}
              </Text>
            </View>
          </View>
        ) : null}

        {empty ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Ask your knowledge base</Text>
            <Text style={styles.emptyBody}>
              Add documents in Library, then ask here — English or Khmer.
            </Text>
          </View>
        ) : null}

        {answer ? (
          <View style={answer.startsWith('⚠️') ? styles.errorCard : styles.answerCard}>
            <Text style={styles.answerText}>{answer}</Text>
            {speed ? <Text style={styles.speed}>{speed}</Text> : null}
          </View>
        ) : null}
        {busy && !answer ? <ActivityIndicator style={{ marginTop: 16 }} color={C.accent} /> : null}

        {sources.length > 0 ? (
          <View style={styles.sources}>
            <Text style={styles.sourcesTitle}>Sources ({sources.length})</Text>
            {sources.map((s, i) => (
              <View key={s.chunk_id} style={styles.source}>
                <Text style={styles.sourceTitle}>
                  [{i + 1}] {s.title}
                </Text>
                <Text style={styles.sourceText} numberOfLines={3}>
                  {s.text}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {sttStatusText ? (
        <Text style={[styles.sttStatus, sttProg.status === 'error' && styles.sttErr]}>
          {sttStatusText}
        </Text>
      ) : null}

      <View style={styles.composer}>
        <Pressable
          style={[styles.mic, listening && styles.micOn]}
          onPress={toggleMic}
          disabled={busy || sttProg.status === 'downloading' || sttProg.status === 'loading'}
          accessibilityLabel={listening ? 'Stop recording' : 'Speak your question'}
        >
          {sttProg.status === 'downloading' || sttProg.status === 'loading' ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <Text style={styles.micIcon}>{listening ? '⏹' : '🎤'}</Text>
          )}
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="Ask a question…"
          placeholderTextColor={C.muted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={onAsk}
          returnKeyType="send"
          editable={!busy && !listening}
        />
        <Pressable
          style={[styles.send, (busy || listening || !query.trim()) && styles.sendDim]}
          onPress={onAsk}
          disabled={busy || listening || !query.trim()}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: 16, paddingBottom: 24, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  notice: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    ...shadow,
  },
  noticeText: { color: C.muted, fontSize: 13, lineHeight: 19 },
  noticeBtn: {
    marginTop: 10,
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  noticeBtnText: { color: '#fff', fontWeight: '700' },
  err: { color: C.danger, fontSize: 12, marginTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: C.text, marginBottom: 6 },
  emptyBody: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 280 },
  answerCard: {
    backgroundColor: C.greenBg,
    borderWidth: 1,
    borderColor: C.greenBorder,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
    ...shadow,
  },
  errorCard: {
    backgroundColor: C.dangerBg,
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
  },
  answerText: { color: '#14532d', fontSize: 15.5, lineHeight: 24 },
  speed: { color: C.greenText, fontSize: 12, marginTop: 12, fontWeight: '600' },
  sources: { marginTop: 14 },
  sourcesTitle: { fontSize: 12, fontWeight: '800', color: C.muted, marginBottom: 8, letterSpacing: 0.4 },
  source: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  sourceTitle: { fontWeight: '700', color: C.text, marginBottom: 3, fontSize: 13.5 },
  sourceText: { color: C.text2, fontSize: 13, lineHeight: 19 },
  composer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    color: C.text,
    backgroundColor: C.bg,
  },
  send: {
    backgroundColor: C.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDim: { backgroundColor: '#a5b4fc' },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  mic: {
    width: 44,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micOn: { backgroundColor: C.dangerBg, borderColor: C.danger },
  micIcon: { fontSize: 19 },
  sttStatus: {
    color: C.muted,
    fontSize: 12.5,
    paddingHorizontal: 14,
    paddingBottom: 6,
    textAlign: 'center',
  },
  sttErr: { color: C.danger },
})
