/**
 * CMD-06 + DL-09: the cron sweep (called from the Worker's scheduled()) relays pending
 * side-effect intents, so a purge left behind by a crashed request completes
 * even when no later command arrives to trigger the in-request relay.
 */
import { describe, expect, it } from 'bun:test'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const { d1, sqlite } = createSqliteD1()
const { runScheduledSideEffectSweep } = await import('@/commands/side-effect-sweep')

const STALE = '2026-01-01T00:00:00.000Z'

describe('scheduled() side-effect intent sweep', () => {
  it('completes a stale pending kv_invalidate intent', async () => {
    sqlite.run(
      `INSERT INTO side_effect_intents (id, command_id, tenant_scope, kind, payload, status, attempts, created_at)
       VALUES ('intent-1', 'cmd-1', 'tenant-a', 'kv_invalidate', '{"tags":["t:tenant-a:c:posts"]}', 'pending', 0, '${STALE}')`
    )
    const deleted: string[] = []
    const kv = {
      get: async () => null,
      put: async () => {},
      delete: async (key: string) => {
        deleted.push(key)
      },
      list: async () => ({ keys: [], list_complete: true, cursor: '' }),
    } as unknown as KVNamespace

    const result = await runScheduledSideEffectSweep({ DB: d1, CACHE: kv } as never)
    expect(result?.claimed).toBe(1)

    const row = sqlite.query(`SELECT status FROM side_effect_intents WHERE id = 'intent-1'`).get() as {
      status: string
    }
    expect(row.status).toBe('done')
  })
})
