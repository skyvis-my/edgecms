import { describe, expect, it } from 'bun:test'
import { Route } from './index'

describe('tenant users route', () => {
  it('normalizes superadmin role filter out in tenant scope', () => {
    const validateSearch = Route.options.validateSearch as {
      safeParse: (input: unknown) => {
        success: boolean
        data?: { role?: string[] }
      }
    }

    expect(validateSearch.safeParse({ role: ['admin'] }).success).toBe(true)
    const result = validateSearch.safeParse({ role: ['superadmin'] })
    expect(result.success).toBe(true)
    expect(result.data?.role).toEqual([])
  })
})
