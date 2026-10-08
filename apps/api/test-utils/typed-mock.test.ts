import { describe, expect, it, vi } from 'bun:test'
import type { Env } from '@/main'
import { asCommandEnv, asMockedFn, asMockedObj } from './typed-mock'

describe('typed-mock helpers', () => {
  it('provides typed wrapper for repository object methods', async () => {
    const repo = {
      getById: vi.fn(async (_id: string) => ({ id: '1' })),
    }

    const mockedRepo = asMockedObj(repo)
    mockedRepo.getById.mockResolvedValue({ id: '2' })

    const result = await repo.getById('1')
    expect(result).toEqual({ id: '2' })
  })

  it('provides typed wrapper for function mocks', async () => {
    const fn = vi.fn(async (_url: string) => new Response('ok'))
    const mockedFn = asMockedFn(fn)
    mockedFn.mockResolvedValue(new Response('mocked'))

    const response = await fn('https://example.com')
    expect(await response.text()).toBe('mocked')
  })

  it('casts partial Env to command-compatible env type', () => {
    const partial: Partial<Env> = { BETTER_AUTH_SECRET: 'secret' }
    const env = asCommandEnv(partial)

    expect(env?.BETTER_AUTH_SECRET).toBe('secret')
  })
})
