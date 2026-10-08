import { describe, expect, it } from 'bun:test'
import { createApiClient } from '../../lib/api-client'

describe('tenant API client', () => {
  it('attaches tenant slug to API headers', async () => {
    const client = createApiClient({ tenantSlug: 'acme' })
    expect(client.defaults.headers['x-tenant']).toBe('acme')
  })
})
