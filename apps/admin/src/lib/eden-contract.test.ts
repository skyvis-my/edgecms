import { describe, expect, it } from 'bun:test'
import { eden } from './eden-client'

describe('eden contract', () => {
  it('has typed admin collections endpoint', () => {
    expect(typeof eden.admin.collections.get).toBe('function')
  })
})
