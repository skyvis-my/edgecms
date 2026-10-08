import { describe, expect, it } from 'bun:test'
import { Route } from './route'

function runBeforeLoad(role: unknown) {
  return Route.options.beforeLoad?.({
    context: {
      user: { role },
    },
  } as never)
}

describe('admin parent route', () => {
  it('allows admin and superadmin roles', () => {
    expect(() => runBeforeLoad('admin')).not.toThrow()
    expect(() => runBeforeLoad('superadmin')).not.toThrow()
    expect(() => runBeforeLoad('super-admin')).not.toThrow()
    expect(() => runBeforeLoad('super_admin')).not.toThrow()
    expect(() => runBeforeLoad('super admin')).not.toThrow()
  })

  it('rejects non-admin roles', () => {
    expect(() => runBeforeLoad('owner')).toThrow()
    expect(() => runBeforeLoad('editor')).toThrow()
    expect(() => runBeforeLoad('viewer')).toThrow()
    expect(() => runBeforeLoad(undefined)).toThrow()
  })
})
