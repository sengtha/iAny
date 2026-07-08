import { useEffect, useState } from 'react'
import { ai } from '../ai/client'
import type { ModelProgress } from '../types'

export function useModelStatus(): Record<'embedder' | 'generator', ModelProgress> {
  const [status, setStatus] = useState({ ...ai.status })
  useEffect(
    () =>
      ai.onProgress(() => {
        setStatus({ embedder: { ...ai.status.embedder }, generator: { ...ai.status.generator } })
      }),
    [],
  )
  return status
}
