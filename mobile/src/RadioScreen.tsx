import { useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { radio } from './radio/player'

/**
 * 📻 iAny Radio — an immersive full-screen player that reads the news feed aloud
 * with the on-device Khmer TTS, always attributing the outlet. Thin view over
 * the RadioPlayer singleton (subscribed via useSyncExternalStore). Styled to
 * match the PWA player (deep-indigo stage, monogram disc, transport controls).
 */
export function RadioScreen({ onClose }: { onClose: () => void }) {
  useSyncExternalStore(
    radio.subscribe,
    () => `${radio.state}|${radio.current?.id ?? ''}|${radio.error}`,
  )
  const { state, current, error } = radio
  const active = state === 'playing' || state === 'waiting' || state === 'loading'
  const playing = state === 'playing'

  const status =
    state === 'loading'
      ? 'កំពុងរៀបចំសំឡេង…'
      : state === 'waiting'
        ? 'រង់ចាំព័ត៌មានថ្មី…'
        : state === 'error'
          ? `មានបញ្ហា៖ ${error}`
          : state === 'paused'
            ? 'ផ្អាក'
            : state === 'idle'
              ? 'ចុច ▶ ដើម្បីស្តាប់ព័ត៌មាន'
              : 'កំពុងចាក់'

  const liveLabel = playing ? 'ON AIR' : active ? 'TUNING' : 'OFF AIR'

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <Text style={styles.word}>📻 iAny Radio</Text>
        <View style={styles.topRight}>
          <View style={[styles.live, playing && styles.liveOn]}>
            <View style={[styles.dot, playing && styles.dotOn]} />
            <Text style={[styles.liveText, playing && styles.liveTextOn]}>{liveLabel}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.stage}>
        <View style={styles.disc}>
          <View style={styles.discFace}>
            <Text style={styles.discText}>{current ? initials(current.outletName) : '📻'}</Text>
          </View>
        </View>
        <View style={styles.eq}>
          {EQ_HEIGHTS.map((h, i) => (
            <View key={i} style={[styles.eqBar, { height: playing ? h : 7 }]} />
          ))}
        </View>
      </View>

      <View style={styles.meta}>
        {current ? (
          <>
            <Text style={styles.outlet}>ព័ត៌មានពី · {current.outletName}</Text>
            <Text style={styles.headline}>{current.title}</Text>
            <Text style={styles.body} numberOfLines={4}>
              {current.body}
            </Text>
            {current.sponsor ? (
              <Text style={styles.sponsor}>ឧបត្ថម្ភដោយ · {current.sponsor}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.idle}>ព័ត៌មានខ្មែរដែលបានផ្ទៀងផ្ទាត់ អានឮៗក្នុងទូរស័ព្ទ</Text>
        )}
      </View>

      <Text style={styles.status}>{status}</Text>

      <View style={styles.transport}>
        <Pressable
          style={[styles.ctl, state === 'idle' && styles.ctlDim]}
          onPress={() => radio.stop()}
          disabled={state === 'idle'}
        >
          <Text style={styles.ctlText}>⏹</Text>
        </Pressable>
        <Pressable
          style={styles.play}
          onPress={() => (active ? radio.pause() : void radio.start())}
        >
          <Text style={styles.playText}>{active ? '⏸' : '▶'}</Text>
        </Pressable>
        <Pressable style={styles.ctl} onPress={() => radio.skip()}>
          <Text style={styles.ctlText}>⏭</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** Two-letter monogram for the disc (Latin initials, else first glyph). */
function initials(name: string): string {
  const latin = name.match(/[A-Za-z]+/g)
  if (latin && latin.length) {
    return latin
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('')
  }
  return Array.from(name.trim())[0] ?? '📻'
}

const EQ_HEIGHTS = [14, 24, 10, 20, 12]

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1e1b4b', padding: 20, alignItems: 'center' },
  top: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  word: { color: '#eef2ff', fontWeight: '800', fontSize: 17 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(199,210,254,0.3)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  liveOn: { borderColor: 'rgba(248,113,113,0.5)' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#64748b' },
  dotOn: { backgroundColor: '#f87171' },
  liveText: { color: '#c7d2fe', fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  liveTextOn: { color: '#fecaca' },
  close: { color: '#c7d2fe', fontSize: 18, fontWeight: '700' },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, width: '100%' },
  disc: {
    width: 176,
    height: 176,
    borderRadius: 88,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4f46e5',
    borderWidth: 10,
    borderColor: '#312e81',
    shadowColor: '#312e81',
    shadowOpacity: 0.6,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  discFace: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2ff',
  },
  discText: { color: '#3730a3', fontWeight: '800', fontSize: 22 },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 26 },
  eqBar: { width: 5, borderRadius: 3, backgroundColor: '#a5b4fc' },

  meta: { width: '100%', maxWidth: 460, minHeight: 96, alignItems: 'center' },
  outlet: {
    color: '#c7d2fe',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  headline: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 27,
    textAlign: 'center',
    marginBottom: 6,
  },
  body: { color: '#cbd5e1', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  sponsor: { color: '#94a3b8', fontSize: 12, fontStyle: 'italic', marginTop: 8 },
  idle: { color: '#cbd5e1', fontSize: 15, textAlign: 'center', lineHeight: 24 },

  status: { color: '#a5b4fc', fontSize: 13, marginVertical: 12 },

  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  ctl: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  ctlDim: { opacity: 0.4 },
  ctlText: { color: '#eef2ff', fontSize: 20 },
  play: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4f46e5',
    shadowColor: '#4f46e5',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  playText: { color: '#ffffff', fontSize: 30 },
})
