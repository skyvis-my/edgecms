import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import type { AiCommandResponse } from './api'
import { GenerateAll } from './components/generate-all'
import { InlineAiAssist } from './components/inline-ai-assist'

const mockedEdenPost = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenPost: mockedEdenPost,
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('InlineAiAssist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders AI assist button', () => {
    render(
      <InlineAiAssist
        fieldName='title'
        fieldType='text'
        currentValue=''
        collectionSlug='articles'
        siblingValues={{}}
        onAcceptSuggestion={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByTitle('AI Suggest')).toBeInTheDocument()
  })

  it('shows loading state when requesting suggestion', async () => {
    const user = userEvent.setup()

    // Mock a delayed response
    mockedEdenPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              commands: [
                {
                  type: 'updateEntry',
                  payload: {
                    data: { title: 'Suggested Title' },
                  },
                },
              ],
              explanation: 'Generated a title suggestion',
            })
          }, 100)
        })
    )

    render(
      <InlineAiAssist
        fieldName='title'
        fieldType='text'
        currentValue=''
        collectionSlug='articles'
        siblingValues={{}}
        onAcceptSuggestion={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    const button = screen.getByTitle('AI Suggest')
    await user.click(button)

    // Should show loading state
    expect(button).toBeDisabled()
  })

  it('displays AI suggestion after successful request', async () => {
    const user = userEvent.setup()

    const mockResponse: AiCommandResponse = {
      commands: [
        {
          type: 'updateEntry',
          payload: {
            data: { title: 'Suggested Title' },
          },
        },
      ],
      explanation: 'Generated a title suggestion',
    }

    mockedEdenPost.mockResolvedValue(mockResponse)

    render(
      <InlineAiAssist
        fieldName='title'
        fieldType='text'
        currentValue=''
        collectionSlug='articles'
        siblingValues={{}}
        onAcceptSuggestion={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    const button = screen.getByTitle('AI Suggest')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText('AI Suggestion')).toBeInTheDocument()
      expect(screen.getByText('Suggested Title')).toBeInTheDocument()
    })
  })

  it('calls onAcceptSuggestion when accept button clicked', async () => {
    const user = userEvent.setup()
    const onAcceptSuggestion = vi.fn()

    const mockResponse: AiCommandResponse = {
      commands: [
        {
          type: 'updateEntry',
          payload: {
            data: { title: 'Suggested Title' },
          },
        },
      ],
      explanation: 'Generated a title suggestion',
    }

    mockedEdenPost.mockResolvedValue(mockResponse)

    render(
      <InlineAiAssist
        fieldName='title'
        fieldType='text'
        currentValue=''
        collectionSlug='articles'
        siblingValues={{}}
        onAcceptSuggestion={onAcceptSuggestion}
      />,
      { wrapper: createWrapper() }
    )

    const button = screen.getByTitle('AI Suggest')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText('AI Suggestion')).toBeInTheDocument()
    })

    const acceptButton = screen.getByTitle('Accept suggestion')
    await user.click(acceptButton)

    expect(onAcceptSuggestion).toHaveBeenCalledWith('Suggested Title')
    expect(screen.queryByText('AI Suggestion')).not.toBeInTheDocument()
  })

  it('dismisses suggestion when reject button clicked', async () => {
    const user = userEvent.setup()

    const mockResponse: AiCommandResponse = {
      commands: [
        {
          type: 'updateEntry',
          payload: {
            data: { title: 'Suggested Title' },
          },
        },
      ],
      explanation: 'Generated a title suggestion',
    }

    mockedEdenPost.mockResolvedValue(mockResponse)

    render(
      <InlineAiAssist
        fieldName='title'
        fieldType='text'
        currentValue=''
        collectionSlug='articles'
        siblingValues={{}}
        onAcceptSuggestion={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    const button = screen.getByTitle('AI Suggest')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText('AI Suggestion')).toBeInTheDocument()
    })

    const rejectButton = screen.getByTitle('Reject suggestion')
    await user.click(rejectButton)

    expect(screen.queryByText('AI Suggestion')).not.toBeInTheDocument()
  })
})

describe('GenerateAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Generate All button', () => {
    render(
      <GenerateAll
        collectionSlug='articles'
        fields={[
          { name: 'title', type: 'text', required: true, localizable: false },
          { name: 'summary', type: 'text', required: false, localizable: false },
        ]}
        currentValues={{ title: '', summary: '' }}
        onApplySuggestions={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.getByText('AI Generate All')).toBeInTheDocument()
  })

  it('disables button when no empty fields', () => {
    render(
      <GenerateAll
        collectionSlug='articles'
        fields={[{ name: 'title', type: 'text', required: true, localizable: false }]}
        currentValues={{ title: 'Existing Title' }}
        onApplySuggestions={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    const button = screen.getByText('AI Generate All')
    expect(button).toBeDisabled()
  })

  it('opens dialog with suggestions on successful generation', async () => {
    const user = userEvent.setup()

    const mockResponse: AiCommandResponse = {
      commands: [
        {
          type: 'updateEntry',
          payload: {
            data: {
              title: 'Suggested Title',
              summary: 'Suggested Summary',
            },
          },
        },
      ],
      explanation: 'Generated suggestions for all fields',
    }

    mockedEdenPost.mockResolvedValue(mockResponse)

    render(
      <GenerateAll
        collectionSlug='articles'
        fields={[
          { name: 'title', type: 'text', required: true, localizable: false },
          { name: 'summary', type: 'text', required: false, localizable: false },
        ]}
        currentValues={{ title: '', summary: '' }}
        onApplySuggestions={vi.fn()}
      />,
      { wrapper: createWrapper() }
    )

    const button = screen.getByText('AI Generate All')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText('AI Field Suggestions')).toBeInTheDocument()
      expect(screen.getByText('Suggested Title')).toBeInTheDocument()
      expect(screen.getByText('Suggested Summary')).toBeInTheDocument()
    })
  })

  it('applies selected suggestions when Accept button clicked', async () => {
    const user = userEvent.setup()
    const onApplySuggestions = vi.fn()

    const mockResponse: AiCommandResponse = {
      commands: [
        {
          type: 'updateEntry',
          payload: {
            data: {
              title: 'Suggested Title',
              summary: 'Suggested Summary',
            },
          },
        },
      ],
      explanation: 'Generated suggestions for all fields',
    }

    mockedEdenPost.mockResolvedValue(mockResponse)

    render(
      <GenerateAll
        collectionSlug='articles'
        fields={[
          { name: 'title', type: 'text', required: true, localizable: false },
          { name: 'summary', type: 'text', required: false, localizable: false },
        ]}
        currentValues={{ title: '', summary: '' }}
        onApplySuggestions={onApplySuggestions}
      />,
      { wrapper: createWrapper() }
    )

    const button = screen.getByText('AI Generate All')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText('AI Field Suggestions')).toBeInTheDocument()
    })

    const acceptButton = screen.getByText(/Accept Selected/)
    await user.click(acceptButton)

    expect(onApplySuggestions).toHaveBeenCalledWith({
      title: 'Suggested Title',
      summary: 'Suggested Summary',
    })
  })

  it('allows toggling individual suggestions', async () => {
    const user = userEvent.setup()
    const onApplySuggestions = vi.fn()

    const mockResponse: AiCommandResponse = {
      commands: [
        {
          type: 'updateEntry',
          payload: {
            data: {
              title: 'Suggested Title',
              summary: 'Suggested Summary',
            },
          },
        },
      ],
      explanation: 'Generated suggestions for all fields',
    }

    mockedEdenPost.mockResolvedValue(mockResponse)

    render(
      <GenerateAll
        collectionSlug='articles'
        fields={[
          { name: 'title', type: 'text', required: true, localizable: false },
          { name: 'summary', type: 'text', required: false, localizable: false },
        ]}
        currentValues={{ title: '', summary: '' }}
        onApplySuggestions={onApplySuggestions}
      />,
      { wrapper: createWrapper() }
    )

    const button = screen.getByText('AI Generate All')
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByText('AI Field Suggestions')).toBeInTheDocument()
    })

    // Toggle off the summary suggestion
    const summaryButton = screen.getByText('Suggested Summary').closest('button')
    if (summaryButton) {
      await user.click(summaryButton)
    }

    const acceptButton = screen.getByText(/Accept Selected/)
    await user.click(acceptButton)

    // Only title should be applied
    expect(onApplySuggestions).toHaveBeenCalledWith({
      title: 'Suggested Title',
    })
  })
})
