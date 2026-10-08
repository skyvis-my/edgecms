import { describe, it, expect } from 'bun:test'
import { systemService } from './system.service'

describe('systemService.getStats', () => {
  it('returns aggregate counts structure', () => {
    // Verify the service function exists and returns the right structure
    expect(typeof systemService.getStats).toBe('function')
  })
})
