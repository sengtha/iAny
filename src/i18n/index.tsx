import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Language } from '../types'
import { en, type Translation } from './en'
import { km } from './km'

const dictionaries: Record<Language, Translation> = { en, km }
const STORAGE_KEY = 'iany.lang'

interface I18nValue {
  lang: Language
  t: (key: keyof Translation) => string
  setLang: (lang: Language) => void
}

const I18nContext = createContext<I18nValue | null>(null)

function initialLang(): Language {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'en' || saved === 'km') return saved
  return navigator.language?.toLowerCase().startsWith('km') ? 'km' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(initialLang)

  const setLang = useCallback((next: Language) => {
    localStorage.setItem(STORAGE_KEY, next)
    setLangState(next)
    document.documentElement.lang = next
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key) => dictionaries[lang][key],
    }),
    [lang, setLang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n outside I18nProvider')
  return ctx
}
