import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'

export { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, mock, spyOn }

export const vi = {
  fn: mock,
  mock: mock.module,
  spyOn: spyOn,
  mocked: <T>(item: T) => item,
  clearAllMocks: () => {
    // Best effort: we can't easily clear all mocks in Bun without tracking them.
    // Tests should rely on auto-clearing or manual clearing if critical.
  },
  stubGlobal: (name: string, value: unknown) => {
    // @ts-expect-error
    globalThis[name] = value
  },
  importActual: async <T = unknown>(path: string): Promise<T> => {
    // Limitation: Bun's mock.module mocks the module globally.
    // Importing it here usually returns the mocked version.
    // We try dynamic import, but it might fail to get the 'actual' one if mocked.
    return import(path) as Promise<T>
  },
}

export type Mock = unknown
