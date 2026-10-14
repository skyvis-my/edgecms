import { describe, expect, it } from 'bun:test'
import { resolveApiBasePath } from './api-base-path'

describe('api-base-path', () => {
  it('resolves the default API base path', () => {
    expect(resolveApiBasePath()).toBe('/api')
    expect(resolveApiBasePath('http://localhost:5173')).toBe('/api')
    expect(resolveApiBasePath('https://cms.example.com')).toBe('/api')
  })
})
