import { PGlite } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import { vector } from '@electric-sql/pglite/vector'

worker({
  async init() {
    return new PGlite({
      dataDir: 'idb://iany-db',
      extensions: { vector },
      relaxedDurability: true,
    })
  },
})
