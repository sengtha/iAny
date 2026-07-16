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
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 12 },
  models: { flex: 1 },
  reset: { alignItems: 'center', paddingVertical: 14 },
  resetText: { color: C.muted, fontWeight: '600', fontSize: 13 },
})
