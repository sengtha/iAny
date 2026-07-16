import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { getDb } from './src/db/database'
import { ChatScreen } from './src/screens/ChatScreen'
import { LibraryScreen } from './src/screens/LibraryScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { RadioScreen } from './src/RadioScreen'
import { PacksScreen } from './src/PacksScreen'
import { C } from './src/theme'

type Tab = 'chat' | 'library' | 'radio' | 'packs' | 'settings'

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'chat', icon: '💬', label: 'Chat' },
  { key: 'library', icon: '📚', label: 'Library' },
  { key: 'radio', icon: '📻', label: 'Radio' },
  { key: 'packs', icon: '📦', label: 'Packs' },
  { key: 'settings', icon: '⚙️', label: 'Settings' },
]

const TITLES: Record<Tab, string> = {
  chat: 'Chat',
  library: 'Library',
  radio: 'Radio',
  packs: 'Packs',
  settings: 'Settings',
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('chat')

  useEffect(() => {
    void (async () => {
      try {
        await getDb()
        setReady(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

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
          <ActivityIndicator color={C.accent} />
        </SafeAreaView>
      </SafeAreaProvider>
    )
  }

  const isRadio = tab === 'radio'

  return (
    <SafeAreaProvider>
      <View style={[styles.root, { backgroundColor: isRadio ? C.radio : C.bg }]}>
        <StatusBar style={isRadio ? 'light' : 'dark'} />
        <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
          {!isRadio ? (
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{TITLES[tab]}</Text>
              <Text style={styles.brand}>iAny</Text>
            </View>
          ) : null}
          <View style={styles.flex}>
            {tab === 'chat' ? <ChatScreen /> : null}
            {tab === 'library' ? <LibraryScreen /> : null}
            {tab === 'radio' ? <RadioScreen /> : null}
            {tab === 'packs' ? <PacksScreen onChanged={() => {}} /> : null}
            {tab === 'settings' ? <SettingsScreen /> : null}
          </View>
        </SafeAreaView>
        <TabBar tab={tab} onChange={setTab} />
      </View>
    </SafeAreaProvider>
  )
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((t) => {
        const active = t.key === tab
        return (
          <Pressable key={t.key} style={styles.tab} onPress={() => onChange(t.key)}>
            <Text style={styles.tabIcon}>{t.icon}</Text>
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  err: { color: C.danger, padding: 24, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.4 },
  brand: { fontSize: 14, fontWeight: '800', color: C.accent, letterSpacing: -0.2 },
  tabbar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  tabIcon: { fontSize: 21, lineHeight: 25 },
  tabLabel: { fontSize: 11, fontWeight: '600', color: C.muted },
  tabLabelActive: { color: C.accent },
})
