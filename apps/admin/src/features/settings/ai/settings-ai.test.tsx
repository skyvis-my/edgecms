import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const edenGet = vi.fn()
const edenPut = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPut,
  edenPost: vi.fn(),
  edenDelete: vi.fn(),
  edenPostForTenant: vi.fn(),
  edenPostMultipart: vi.fn(),
}))

const { SettingsAi } = await import('./index?real')

const providers = [
  { id: 'qwen', name: 'Qwen', operator: 'Alibaba Cloud', route: 'Cloudflare AI Gateway', purpose: 'Primary' },
  { id: 'gemini', name: 'Gemini', operator: 'Google', route: 'Cloudflare AI Gateway', purpose: 'Fallback' },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SettingsAi />
    </QueryClientProvider>
  )
}

describe('SettingsAi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the providers that receive content and turns AI on', async () => {
    edenGet.mockResolvedValueOnce({ aiEnabled: false, canManage: true, providers })
    edenPut.mockResolvedValueOnce({ aiEnabled: true, canManage: true, providers })
    renderPage()

    expect(await screen.findByText('Alibaba Cloud')).toBeTruthy()
    expect(screen.getByText('Google')).toBeTruthy()
    expect(screen.getByText(/no content from this tenant is sent/)).toBeTruthy()

    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(edenPut).toHaveBeenCalledWith('/admin/settings/ai', { aiEnabled: true }))
    expect(await screen.findByText(/^On:/)).toBeTruthy()
  })

  it('is read-only for members who cannot manage it', async () => {
    edenGet.mockResolvedValueOnce({ aiEnabled: true, canManage: false, providers })
    renderPage()
    const toggle = await screen.findByRole('switch')
    expect(toggle).toHaveProperty('disabled', true)
    expect(screen.getByText('Only tenant owners and admins can change this.')).toBeTruthy()
  })
})
