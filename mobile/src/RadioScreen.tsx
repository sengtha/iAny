import { useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { radio } from './radio/player'

/**
 * 📻 iAny Radio — plays the news feed aloud with the on-device Khmer TTS,
 * attributing each item to its outlet. A thin view over the RadioPlayer
 * singleton (subscribed via useSyncExternalStore).
 */
export function RadioScreen({ onClose }: { onClose: () => void }) {
  // Re-render whenever the player emits; the snapshot string encodes what the UI shows.
  useSyncExternalStore(
    radio.subscribe,
    () => `${radio.state}|${radio.current?.id ?? ''}|${radio.error}`,
  )
  const { state, current, error } = radio
  const active = state === 'playing' || state === 'waiting' || state === 'loading'

  const status =
    state === 'loading'
      ? 'កំពុងរៀបចំសំឡេង… (loading voice)'
      : state === 'waiting'
        ? 'រង់ចាំព័ត៌មានថ្មី… (waiting for news)'
        : state === 'error'
          ? `មានបញ្ហា៖ ${error}`
          : state === 'paused'
            ? 'ផ្អាក (paused)'
            : state === 'idle'
              ? 'ចុច ▶ ដើម្បីស្តាប់ព័ត៌មាន (press play)'
              : 'កំពុងចាក់ (on air)'

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>📻 iAny Radio</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      {current ? (
        <View style={styles.now}>
          <Text style={styles.outlet}>{current.outletName}</Text>
          <Text style={styles.headline}>{current.title}</Text>
          <Text style={styles.body} numberOfLines={4}>
            {current.body}
          </Text>
          {current.sponsor ? (
            <Text style={styles.sponsor}>ឧបត្ថម្ភដោយ · {current.sponsor}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.status}>{status}</Text>
      )}
      {current ? <Text style={styles.status}>{status}</Text> : null}

      <View style={styles.controls}>
        {active ? (
          <Pressable style={[styles.btn, styles.primary]} onPress={() => radio.pause()}>
            <Text style={styles.btnTextLight}>⏸ ផ្អាក</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.btn, styles.primary]} onPress={() => void radio.start()}>
            <Text style={styles.btnTextLight}>▶ ស្តាប់</Text>
          </Pressable>
        )}
        <Pressable style={styles.btn} onPress={() => radio.skip()}>
          <Text style={styles.btnText}>⏭ បន្ទាប់</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => radio.stop()}>
          <Text style={styles.btnText}>⏹ បញ្ឈប់</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#3730a3' },
  close: { fontSize: 16, color: '#6366f1', fontWeight: '600' },
  now: { gap: 3 },
  outlet: { fontSize: 12, fontWeight: '700', color: '#4f46e5' },
  headline: { fontSize: 15, fontWeight: '600', color: '#1e1b4b' },
  body: { fontSize: 13, color: '#334155' },
  sponsor: { fontSize: 11, color: '#64748b', fontStyle: 'italic' },
  status: { fontSize: 12, color: '#475569' },
  controls: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#fff',
  },
  primary: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  btnText: { color: '#3730a3', fontWeight: '600', fontSize: 13 },
  btnTextLight: { color: '#fff', fontWeight: '700', fontSize: 13 },
})
