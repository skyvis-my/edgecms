import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AiCommandResponse } from './api'
import * as api from './api'
import { AiChatPanel } from './components/ai-chat-panel'

// Mock the API module
vi.mock('./api', () => ({
  useAiCommand: vi.fn(),
}))

// Mock router params
vi.mock('@tanstack/react-router', () => ({
  useParams: vi.fn(() => ({})),
}))

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  SparklesIcon: () => <div data-testid='sparkles-icon' />,
  SendIcon: () => <div data-testid='send-icon' />,
  Loader2Icon: () => <div data-testid='loader-icon' />,
  XIcon: () => <div data-testid='x-icon' />,
}))

describe('AiChatPanel', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.clearAllMocks()

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn()
  })

  const renderPanel = (props = {}) => {
    const defaultProps = {
      open: true,
      onOpenChange: vi.fn(),
      ...props,
    }

    return render(
      <QueryClientProvider client={queryClient}>
        <AiChatPanel {...defaultProps} />
      </QueryClientProvider>
    )
  }

  it('renders panel when open', () => {
    api.useAiCommand.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    expect(screen.getByText('AI Assistant')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type your message...')).toBeInTheDocument()
  })

  it('does not render panel when closed', () => {
    api.useAiCommand.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel({ open: false })

    expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument()
  })

  it('shows empty state when no messages', () => {
    api.useAiCommand.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    expect(screen.getByText('Start a conversation with the AI assistant')).toBeInTheDocument()
  })

  it('sends message when user types and presses enter', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: [],
      explanation: 'Test response',
      results: [],
    } as AiCommandResponse)

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Create a blog post')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        prompt: 'Create a blog post',
        context: undefined,
        dryRun: true,
      })
    })
  })

  it('sends message when user clicks send button', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: [],
      explanation: 'Test response',
      results: [],
    } as AiCommandResponse)

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Update entry title')

    const sendButton = screen.getByRole('button', { name: /send message/i })
    await user.click(sendButton)

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        prompt: 'Update entry title',
        context: undefined,
        dryRun: true,
      })
    })
  })

  it('displays user message in conversation', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: [],
      explanation: 'AI response',
      results: [],
    } as AiCommandResponse)

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Hello AI')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Hello AI')).toBeInTheDocument()
    })
  })

  it('displays AI response with explanation', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: [],
      explanation: 'I understand you want to create a blog post',
      results: [],
    } as AiCommandResponse)

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Create a blog post')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('I understand you want to create a blog post')).toBeInTheDocument()
    })
  })

  it('displays generated commands as preview cards', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: [
        {
          type: 'createEntry',
          payload: { collectionId: 'blog', data: { title: 'New Post' } },
          actor: { userId: 'user1', source: 'ai' as const },
          timestamp: new Date().toISOString(),
        },
      ],
      explanation: 'Creating a new blog entry',
      results: [],
    } as AiCommandResponse)

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Create blog post')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Create Entry')).toBeInTheDocument()
      expect(screen.getByText('Generated commands:')).toBeInTheDocument()
    })
  })

  it('shows execute and cancel buttons for commands', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: [
        {
          type: 'createEntry',
          payload: { collectionId: 'blog' },
          actor: { userId: 'user1', source: 'ai' as const },
          timestamp: new Date().toISOString(),
        },
      ],
      explanation: 'Command ready',
      results: [],
    } as AiCommandResponse)

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Create entry')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })
  })

  it('executes commands when execute button is clicked', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi
      .fn()
      .mockResolvedValueOnce({
        commands: [
          {
            type: 'createEntry',
            payload: { collectionId: 'blog' },
            actor: { userId: 'user1', source: 'ai' as const },
            timestamp: new Date().toISOString(),
          },
        ],
        explanation: 'Command ready',
        results: [],
      } as AiCommandResponse)
      .mockResolvedValueOnce({
        commands: [],
        explanation: 'Command ready',
        results: [
          {
            commandId: 'cmd1',
            type: 'createEntry',
            status: 'success' as const,
            executedAt: new Date().toISOString(),
          },
        ],
      } as AiCommandResponse)

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Create entry')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /execute/i })).toBeInTheDocument()
    })

    const executeButton = screen.getByRole('button', { name: /execute/i })
    await user.click(executeButton)

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(2)
      expect(mutateAsync).toHaveBeenNthCalledWith(2, {
        prompt: 'Create entry',
        context: undefined,
        dryRun: false,
      })
    })
  })

  it('shows loading state while AI is processing', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                commands: [],
                explanation: 'Response',
                results: [],
              }),
            100
          )
        )
    )

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: true,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Test')
    await user.keyboard('{Enter}')

    expect(screen.getByText('AI is thinking...')).toBeInTheDocument()
  })

  it('includes context from route params when available', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: [],
      explanation: 'Response',
      results: [],
    } as AiCommandResponse)

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    // Mock route params
    const useParams = await import('@tanstack/react-router').then((m) => m.useParams)
    useParams.mockReturnValue({
      collectionId: 'blog',
      entryId: 'entry123',
    })

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Update this')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        prompt: 'Update this',
        context: {
          collectionSlug: 'blog',
          entryId: 'entry123',
        },
        dryRun: true,
      })
    })
  })

  it('clears messages when panel closes', async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      commands: [],
      explanation: 'Response',
      results: [],
    } as AiCommandResponse)

    const onOpenChange = vi.fn()

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof api.useAiCommand>)

    const { rerender } = renderPanel({ onOpenChange })

    // Add a message
    const input = screen.getByPlaceholderText('Type your message...')
    await user.type(input, 'Test message')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })

    // Close panel
    rerender(
      <QueryClientProvider client={queryClient}>
        <AiChatPanel open={false} onOpenChange={onOpenChange} />
      </QueryClientProvider>
    )

    // Reopen panel
    rerender(
      <QueryClientProvider client={queryClient}>
        <AiChatPanel open={true} onOpenChange={onOpenChange} />
      </QueryClientProvider>
    )

    // Messages should be cleared
    expect(screen.queryByText('Test message')).not.toBeInTheDocument()
    expect(screen.getByText('Start a conversation with the AI assistant')).toBeInTheDocument()
  })

  it('disables input and buttons during loading', async () => {
    const _user = userEvent.setup()
    const mutateAsync = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                commands: [],
                explanation: 'Response',
                results: [],
              }),
            100
          )
        )
    )

    api.useAiCommand.mockReturnValue({
      mutateAsync,
      isPending: true,
    } as ReturnType<typeof api.useAiCommand>)

    renderPanel()

    const input = screen.getByPlaceholderText('Type your message...')
    const sendButton = screen.getByRole('button', { name: /send message/i })

    expect(input).toBeDisabled()
    expect(sendButton).toBeDisabled()
  })
})
