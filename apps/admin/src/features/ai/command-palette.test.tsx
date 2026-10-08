import { beforeEach, describe, expect, it, vi } from 'bun:test'
import '../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { CommandPalette } from './components/command-palette'

// Mock TanStack Router
const mockNavigate = vi.fn()
const mockAIMutate = vi.fn()
const mockUseAICommand = {
  mutate: mockAIMutate,
  isPending: false,
}
const mockUseAiCommandImpl = vi.fn(() => mockUseAICommand)
const mockExecuteCommandMutateAsync = vi.fn()
const mockDryRunCommandMutateAsync = vi.fn()
vi.mock('@tanstack/react-router', () => {
  return {
    useNavigate: () => mockNavigate,
  }
})

// Mock AI API
vi.mock('./api', () => ({
  useAiCommand: () => mockUseAiCommandImpl(),
}))

vi.mock('@/features/commands/use-execute-command', () => ({
  useExecuteCommand: () => ({
    mutateAsync: mockExecuteCommandMutateAsync,
  }),
  useDryRunCommand: () => ({
    mutateAsync: mockDryRunCommandMutateAsync,
  }),
}))

// Mock tenant slug so navigation paths are deterministic regardless of localStorage
vi.mock('@/features/tenants/api', () => ({
  getCurrentTenantSlug: () => 'test-tenant',
}))

vi.mock('@/components/ui/command', () => ({
  CommandDialog: ({
    open,
    children,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: ReactNode
  }) => (open ? <div>{children}</div> : null),
  CommandInput: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value: string
    onValueChange: (value: string) => void
    placeholder: string
  }) => (
    <input
      aria-label='command-input'
      placeholder={placeholder}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    />
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode; heading?: string }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode
    value: string
    onSelect: () => void
  }) => (
    <button type='button' onClick={onSelect}>
      {children}
    </button>
  ),
  CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAICommand.isPending = false
    mockUseAiCommandImpl.mockImplementation(() => mockUseAICommand)
    mockExecuteCommandMutateAsync.mockResolvedValue({})
    mockDryRunCommandMutateAsync.mockResolvedValue([{ field: 'title' }])
    // Mock scrollIntoView for jsdom
    Element.prototype.scrollIntoView = vi.fn()
    Object.defineProperty(window, 'confirm', {
      writable: true,
      value: vi.fn(() => true),
    })
  })

  it('does not trigger a render loop when mutation hook identity changes', () => {
    mockUseAiCommandImpl.mockImplementation(() => ({
      mutate: mockAIMutate,
      isPending: false,
    }))

    expect(() => render(<CommandPalette />, { wrapper: createWrapper() })).not.toThrow()
  })

  it('opens palette when Cmd+K is pressed', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />, { wrapper: createWrapper() })

    // Initially closed
    expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument()

    // Press Cmd+K
    await user.keyboard('{Meta>}k{/Meta}')

    // Now open
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument()
    })
  })

  it('toggles palette closed when shortcut is pressed again', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />, { wrapper: createWrapper() })

    // Open palette
    await user.keyboard('{Meta>}k{/Meta}')

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument()
    })

    // Press Cmd+K again
    await user.keyboard('{Meta>}k{/Meta}')

    // Should be closed
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument()
    })
  })

  it('shows static commands by default', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />, { wrapper: createWrapper() })

    // Open palette
    await user.keyboard('{Meta>}k{/Meta}')

    await waitFor(() => {
      expect(screen.getByText('Go to Collections')).toBeInTheDocument()
      expect(screen.getByText('Go to Entries')).toBeInTheDocument()
      expect(screen.getByText('Go to Webhooks')).toBeInTheDocument()
      expect(screen.getByText('Create Collection')).toBeInTheDocument()
    })
  })

  it('filters static commands on input', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />, { wrapper: createWrapper() })

    // Open palette
    await user.keyboard('{Meta>}k{/Meta}')

    const input = await screen.findByPlaceholderText('Type a command or search...')

    // Type "collection"
    await user.type(input, 'collection')

    await waitFor(() => {
      expect(screen.getByText('Go to Collections')).toBeInTheDocument()
      expect(screen.getByText('Create Collection')).toBeInTheDocument()
      expect(screen.queryByText('Go to Entries')).not.toBeInTheDocument()
    })
  })

  it('executes static command on selection', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />, { wrapper: createWrapper() })

    // Open palette
    await user.keyboard('{Meta>}k{/Meta}')

    const collectionsCommand = await screen.findByText('Go to Collections')

    // Click command
    await user.click(collectionsCommand)

    // Should navigate and close palette
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/tenants/test-tenant/collections' })
      expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument()
    })
  })

  it('executes command when selected', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />, { wrapper: createWrapper() })

    // Open palette
    await user.keyboard('{Meta>}k{/Meta}')

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument()
    })

    const entriesCommand = await screen.findByText('Go to Entries')
    await user.click(entriesCommand)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/tenants/test-tenant/collections' })
    })
  })

  it('navigates to collection creation route', async () => {
    const user = userEvent.setup()
    render(<CommandPalette />, { wrapper: createWrapper() })

    await user.keyboard('{Meta>}k{/Meta}')

    const createCollectionCommand = await screen.findByText('Create Collection')
    await user.click(createCollectionCommand)

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/tenants/test-tenant/collections/create' })
    })
  })

  it('executes AI command suggestions through command mutations', async () => {
    const user = userEvent.setup()
    mockAIMutate.mockImplementation(
      (
        _input: { prompt: string; dryRun: boolean },
        options: {
          onSuccess?: (result: {
            commands: Array<{ type: string; payload: Record<string, unknown>; actor: { userId: string; source: 'ai' }; timestamp: string }>
            explanation: string
          }) => void
        }
      ) => {
        options.onSuccess?.({
          commands: [
            {
              type: 'updateEntry',
              payload: { entryId: 'e1', data: { title: 'Updated' } },
              actor: { userId: 'ai', source: 'ai' },
              timestamp: new Date().toISOString(),
            },
          ],
          explanation: 'Update entry title',
        })
      }
    )

    render(<CommandPalette />, { wrapper: createWrapper() })
    await user.keyboard('{Meta>}k{/Meta}')
    const input = await screen.findByPlaceholderText('Type a command or search...')
    await user.type(input, 'update title with ai')

    const aiSuggestion = await screen.findByText('Update entry title')
    await user.click(aiSuggestion)

    await waitFor(() => {
      expect(mockDryRunCommandMutateAsync).toHaveBeenCalledTimes(1)
      expect(mockExecuteCommandMutateAsync).toHaveBeenCalledTimes(1)
    })
  })
})
