import { describe, expect, it } from 'bun:test'

import { Route } from './index'

describe('users route', () => {
  it('redirects legacy /users path to /admin/users', () => {
    expect(() =>
      Route.options.beforeLoad?.({
        location: { href: 'http://localhost:5173/users' },
      } as never)
    ).toThrow()
  })
})
