import type { ModelStatus } from '../types'

export type AIRequest =
  | { id: string; type: 'configure'; modelHost?: string; generationModel?: string }
  | { id: string; type: 'preload'; target: 'embedder' | 'generator' }
  | { id: string; type: 'embed'; texts: string[]; kind: 'query' | 'document' }
  | {
      id: string
      type: 'generate'
      messages: { role: string; content: string }[]
      maxNewTokens: number
    }

export type AIResponse =
  | { id: string; type: 'result'; data: unknown }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'token'; token: string; reset?: boolean }
  | { type: 'progress'; target: 'embedder' | 'generator'; progress: number; file?: string }
  | {
      type: 'status'
      target: 'embedder' | 'generator'
      status: ModelStatus
      error?: string
    }
