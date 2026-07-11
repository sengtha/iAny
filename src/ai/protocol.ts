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
      /** When set, messages[0].content is a fully pre-formatted prompt
       *  string, generated as raw text (no chat template applied). Used for
       *  models whose exported tokenizer lacks an inline chat template. */
      raw?: boolean
    }

export type AIResponse =
  | { id: string; type: 'result'; data: unknown }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'token'; token: string; reset?: boolean }
  | {
      type: 'progress'
      target: 'embedder' | 'generator'
      progress: number
      file?: string
      /** true when bytes are crossing the network; false = disk read */
      network?: boolean
    }
  | {
      type: 'status'
      target: 'embedder' | 'generator'
      status: ModelStatus
      error?: string
      device?: 'webgpu' | 'wasm'
    }
