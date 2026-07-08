import { PGliteWorker } from '@electric-sql/pglite/worker'
import { SCHEMA_SQL } from './schema'

let dbPromise: Promise<PGliteWorker> | null = null

export function getDB(): Promise<PGliteWorker> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = new PGliteWorker(
        new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      )
      await db.waitReady
      await db.exec(SCHEMA_SQL)
      return db
    })()
  }
  return dbPromise
}
