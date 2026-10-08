import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import '../../../test-utils/setup'

const { db } = await import(`./local-db?bypass=${Date.now()}`)

describe('local-db schema snapshots', () => {
  beforeEach(async () => {
    await db.schemaSnapshots.clear()
  })

  afterEach(async () => {
    await db.schemaSnapshots.clear()
  })

  it('stores schema snapshots locally', async () => {
    await db.schemaSnapshots.add({
      id: 's1',
      tenantId: 'global',
      schemaVersion: 1,
      payload: {},
      createdAt: new Date().toISOString(),
    })

    const stored = await db.schemaSnapshots.get('s1')
    expect(stored).toBeDefined()
    expect(stored?.schemaVersion).toBe(1)
  })
})
