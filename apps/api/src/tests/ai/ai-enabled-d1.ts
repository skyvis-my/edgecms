/**
 * Minimal D1 stand-in that answers the HS-14 `tenants.aiEnabled` lookup, for
 * tests of AI paths that otherwise use mocked bindings.
 */
export function aiSwitchD1(enabled: boolean): D1Database {
  const value = enabled ? 1 : 0
  const statement = {
    bind: () => statement,
    all: async () => ({ results: [{ aiEnabled: value }], success: true, meta: {} }),
    raw: async () => [[value]],
    first: async () => ({ aiEnabled: value }),
    run: async () => ({ success: true, meta: {} }),
  }
  return { prepare: () => statement } as unknown as D1Database
}
