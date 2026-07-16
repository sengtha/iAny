import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { radio } from './radio/player'

/**
 * 📻 iAny Radio — an immersive full-screen player that reads the news feed aloud
 * with the on-device Khmer TTS, always attributing the outlet. Thin view over
 * the RadioPlayer singleton (subscribed via useSyncExternalStore). Matches the
 * PWA player: deep-indigo stage, spinning monogram disc, animated equalizer,
 * blinking ON AIR badge, circular transport controls.
 */
export function RadioScreen({ onClose }: { onClose: () => void }) {
  useSyncExternalStore(
    radio.subscribe,
    () => `${radio.state}|${radio.current?.id ?? ''}|${radio.error}|${radio.todayItems.length}`,
  )
  useEffect(() => {
    void radio.refresh()
  }, [])
  const { height } = useWindowDimensions()
  const { state, current, error } = radio
  const today = radio.todayItems
  const active = state === 'playing' || state === 'waiting' || state === 'loading'
  const playing = state === 'playing'

  // Animations (mirror the PWA CSS): disc spin, equalizer bounce, ON AIR blink.
  const spin = useRef(new Animated.Value(0)).current
  const dot = useRef(new Animated.Value(1)).current
  const bars = useRef(EQ_MAX.map(() => new Animated.Value(7))).current

  useEffect(() => {
    if (!playing) {
      spin.stopAnimation()
      spin.setValue(0)
      dot.stopAnimation()
      dot.setValue(1)
      bars.forEach((b) => {
        b.stopAnimation()
        b.setValue(7)
      })
      return
    }
    const spinLoop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true }),
    )
    const dotLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(dot, { toValue: 0.2, duration: 500, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    )
    const barLoops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: EQ_MAX[i], duration: 280 + i * 55, useNativeDriver: false }),
          Animated.timing(b, { toValue: 7, duration: 280 + i * 55, useNativeDriver: false }),
        ]),
      ),
    )
    spinLoop.start()
    dotLoop.start()
    barLoops.forEach((l) => l.start())
    return () => {
      spinLoop.stop()
      dotLoop.stop()
      barLoops.forEach((l) => l.stop())
    }
  }, [playing, spin, dot, bars])

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

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
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={[styles.screen, { minHeight: height - 40 }]}>
      <View style={styles.top}>
        <Text style={styles.word}>📻 iAny Radio</Text>
        <View style={styles.topRight}>
          <View style={[styles.live, playing && styles.liveOn]}>
            <Animated.View
              style={[styles.dot, playing && styles.dotOn, playing && { opacity: dot }]}
            />
            <Text style={[styles.liveText, playing && styles.liveTextOn]}>{liveLabel}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.stage}>
        <View style={styles.discWrap}>
          <Animated.View style={[styles.disc, { transform: [{ rotate }] }]} />
          <View style={styles.discFace}>
            <Text style={styles.discText}>{current ? initials(current.outletName) : '📻'}</Text>
          </View>
        </View>
        <View style={styles.eq}>
          {bars.map((h, i) => (
            <Animated.View key={i} style={[styles.eqBar, { height: h }]} />
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

      {today.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.listTitle}>ថ្ងៃនេះ · Today</Text>
          {today.map((item) => (
            <Pressable
              key={item.id}
              style={[styles.item, item.id === current?.id && styles.itemOn]}
              onPress={() => void radio.playItem(item)}
            >
              <Text style={styles.itemMeta}>
                {item.outletName} · {fmtTime(item.createdAt)}
              </Text>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  )
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso)
    let h = d.getHours()
    const m = d.getMinutes().toString().padStart(2, '0')
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${h}:${m} ${ampm}`
  } catch {
    return ''
  }
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

const EQ_MAX = [16, 26, 12, 22, 14]

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#1e1b4b' },
  scrollContent: { flexGrow: 1 },
  screen: { backgroundColor: '#1e1b4b', padding: 20, alignItems: 'center' },

  list: { paddingHorizontal: 16, paddingBottom: 28, backgroundColor: '#1e1b4b' },
  listTitle: {
    color: '#a5b4fc',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  item: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 3,
  },
  itemOn: { borderColor: 'rgba(129,140,248,0.7)', backgroundColor: 'rgba(129,140,248,0.12)' },
  itemMeta: { color: '#a5b4fc', fontSize: 12, fontWeight: '700' },
  itemTitle: { color: '#eef2ff', fontSize: 15, lineHeight: 21 },
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
  discWrap: { width: 176, height: 176, alignItems: 'center', justifyContent: 'center' },
  disc: {
    position: 'absolute',
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: '#4f46e5',
    borderTopColor: '#a5b4fc',
    borderRightColor: '#312e81',
    borderBottomColor: '#312e81',
    borderLeftColor: '#312e81',
    borderWidth: 10,
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
