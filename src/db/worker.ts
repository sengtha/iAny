import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import { vector } from '@electric-sql/pglite/vector'

worker({
  async init() {
    // relaxedDurability must stay OFF: with it, queries return before the
    // IndexedDB flush completes, and a refresh during that window silently
    // loses every write since the last flush (reproduced: rapid reload
    // after INSERT dropped the row). Durable writes cost a few ms per
    // query, which ingest batching absorbs.
    return new PGlite({
      dataDir: 'idb://iany-db',
      extensions: { vector },
    })
  },
})
