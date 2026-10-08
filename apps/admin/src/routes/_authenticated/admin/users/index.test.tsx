import { describe, expect, it } from 'bun:test'
import { Route } from './index'

describe('admin users route', () => {
  it('does not require tenant context in beforeLoad', () => {
    expect(Route.options.beforeLoad).toBeUndefined()
  })
})
