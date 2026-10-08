import { describe, expect, it } from 'bun:test'
import { schemaSnapshots } from '@/database/schema/schema-snapshots.schema'

describe('schemaSnapshots schema', () => {
  it('defines schema_snapshots table with expected columns', () => {
    expect(schemaSnapshots).toBeDefined()
    expect(schemaSnapshots.id).toBeDefined()
    expect(schemaSnapshots.tenantId).toBeDefined()
    expect(schemaSnapshots.schemaVersion).toBeDefined()
    expect(schemaSnapshots.payload).toBeDefined()
    expect(schemaSnapshots.createdAt).toBeDefined()
  })
})
