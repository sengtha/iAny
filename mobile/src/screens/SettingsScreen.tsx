import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { ModelsScreen } from '../ModelsScreen'
import { generator } from '../ai/generator'
import { embedder } from '../ai/embedder'
import { tts } from '../ai/tts'
import { clearModelCache } from '../ai/modelFile'
import { C } from '../theme'

/**
 * Settings — model management (download / share / delete each model, pick the
 * LLM) plus a reset that clears every downloaded model and its cache.
 */
export function SettingsScreen() {
  const [busy, setBusy] = useState(false)

  const resetAll = () => {
    Alert.alert(
      'Reset all models?',
      'This deletes every downloaded model and cache. You can re-download them anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setBusy(true)
            try {
              await generator.release().catch(() => {})
              await embedder.release().catch(() => {})
              await tts.reset().catch(() => {})
              await clearModelCache()
            } finally {
              setBusy(false)
            }
          },
        },
      ],
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.models}>
        <ModelsScreen />
      </View>
      <Pressable style={styles.reset} onPress={resetAll} disabled={busy}>
        <Text style={styles.resetText}>{busy ? 'Resetting…' : '↻ Reset all models & cache'}</Text>
      </Pressable>

      <View style={styles.credits}>
        <Text style={styles.creditsTitle}>CREDITS</Text>
        <Text style={styles.creditsLine}>
          Khmer voice — DDD-Cambodia corpus (CC-BY-SA-4.0) · VITS / Coqui TTS
        </Text>
        <Text style={styles.creditsLine}>Khmer OCR — seanghay/KhmerOCR (MIT)</Text>
        <Text style={styles.creditsLine}>Answering — Qwen3-0.6B (Apache-2.0), Gemma (Google)</Text>
        <Text style={styles.creditsLine}>Semantic search — EmbeddingGemma (Google)</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 12 },
  models: { flex: 1 },
  reset: { alignItems: 'center', paddingVertical: 14 },
  resetText: { color: C.muted, fontWeight: '600', fontSize: 13 },
  credits: { paddingHorizontal: 4, paddingBottom: 8, gap: 3 },
  creditsTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: C.muted,
    marginBottom: 2,
  },
  creditsLine: { fontSize: 11.5, color: C.muted, lineHeight: 16 },
})
