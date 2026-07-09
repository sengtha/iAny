import { PGliteWorker } from '@electric-sql/pglite/worker'
import { SCHEMA_SQL } from './schema'

const INIT_TIMEOUT_MS = 30_000

let dbPromise: Promise<PGliteWorker> | null = null

export function getDB(): Promise<PGliteWorker> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = new PGliteWorker(
        new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
      )
      // A database left in a bad state (e.g. by a tab crash mid-write) can
      // hang the open forever with no error. Convert that into a visible,
      // recoverable failure.
      await Promise.race([
        (async () => {
          await db.waitReady
          await db.exec(SCHEMA_SQL)
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('db-init-timeout')), INIT_TIMEOUT_MS),
        ),
      ])
      return db
    })()
    dbPromise.catch(() => {
      dbPromise = null // allow retry after a failure
    })
  }
  return dbPromise
}

/** Last-resort recovery for a corrupted local database: delete PGlite's
 *  IndexedDB storage and reload. All local documents are lost (models and
 *  cloud backups are unaffected — they live elsewhere). */
export async function resetDatabase(): Promise<void> {
  const dbs = (await indexedDB.databases?.()) ?? []
  for (const info of dbs) {
    if (info.name && info.name.includes('iany-db')) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(info.name!)
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      })
    }
  }
  location.reload()
}
