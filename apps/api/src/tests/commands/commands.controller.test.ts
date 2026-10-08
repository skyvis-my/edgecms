import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockDb = {} as D1Database
const mockKv = {} as KVNamespace
const mockExecuteCommand = vi.fn()

vi.mock('cloudflare:workers', () => ({
  env: { DB: mockDb, CACHE: mockKv, MEDIA: {} as R2Bucket },
}))

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      resolve() {
        return { user: { id: 'auth-user-1' } }
      },
    },
  }),
}))

vi.mock('../../commands/engine', () => ({
  executeCommand: mockExecuteCommand,
}))

const { commandsController } = await import(
  `../../commands/commands.controller?bypass=${Date.now()}`
)

describe('commandsController', () => {
  const app = new Elysia().use(commandsController)

  const baseBody = {
    type: 'updateEntry',
    payload: { id: 'e1' },
    actor: { userId: 'spoofed', source: 'admin' },
    timestamp: new Date().toISOString(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 201 for createEntry success and overrides actor userId', async () => {
    mockExecuteCommand.mockResolvedValue({
      status: 'success',
      type: 'createEntry',
      data: { id: 'e1' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...baseBody, type: 'createEntry' }),
      })
    )

    expect(response.status).toBe(201)
    const firstCall = mockExecuteCommand.mock.calls[0]
    expect(firstCall).toBeDefined()
    if (!firstCall) {
      throw new Error('Expected executeCommand to be called')
    }
    const [, envelope] = firstCall
    expect(envelope.actor.userId).toBe('auth-user-1')
  })

  it('returns 200 for dry_run', async () => {
    mockExecuteCommand.mockResolvedValue({ status: 'dry_run', type: 'updateEntry', diff: [] })

    const response = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(baseBody),
      })
    )

    expect(response.status).toBe(200)
  })

  it('maps known error codes to status codes', async () => {
    const cases = [
      ['VERSION_CONFLICT', 409],
      ['NOT_FOUND', 404],
      ['VALIDATION_ERROR', 400],
      ['INVALID_COMMAND_TYPE', 400],
      ['UNKNOWN_COMMAND', 400],
      ['INVALID_TRANSITION', 400],
      ['INVALID_STATUS_TRANSITION', 400],
      ['INVALID_PREVIEW_RECEIPT', 400],
      ['UNAUTHORIZED', 403],
    ] as const

    for (const [code, status] of cases) {
      mockExecuteCommand.mockResolvedValueOnce({ status: 'failed', error: { code, message: 'x' } })
      const response = await app.handle(
        new Request('http://localhost/api/admin/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(baseBody),
        })
      )
      expect(response.status).toBe(status)
    }
  })

  it('forwards previewReceipt in envelope to executeCommand', async () => {
    mockExecuteCommand.mockResolvedValueOnce({
      status: 'success',
      type: 'updateEntry',
      data: { id: 'e1' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...baseBody,
          previewReceipt: 'rcpt_test_123',
        }),
      })
    )

    expect(response.status).toBe(200)
    const calls = mockExecuteCommand.mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall).toBeDefined()
    const [, envelope] = lastCall!
    expect(envelope.previewReceipt).toBe('rcpt_test_123')
  })

  it('returns 500 for unknown error code and for missing error object', async () => {
    mockExecuteCommand.mockResolvedValueOnce({
      status: 'failed',
      error: { code: 'SOMETHING_ELSE', message: 'x' },
    })

    const unknownResponse = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(baseBody),
      })
    )
    expect(unknownResponse.status).toBe(500)

    mockExecuteCommand.mockResolvedValueOnce({ status: 'failed' })

    const fallbackResponse = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(baseBody),
      })
    )
    expect(fallbackResponse.status).toBe(500)
  })
})
