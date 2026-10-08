import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhook,
  useWebhookDeliveries,
  useWebhooks,
  type WebhookDefinition,
  type WebhookDelivery,
} from './api'
import { DeliveryLog } from './delivery-log'
import { WebhookForm } from './webhook-form'
import { WebhookList } from './webhook-list'

// Mock dependencies
vi.mock('./api', () => ({
  useWebhooks: vi.fn(),
  useWebhook: vi.fn(),
  useCreateWebhook: vi.fn(),
  useUpdateWebhook: vi.fn(),
  useDeleteWebhook: vi.fn(),
  useTestWebhook: vi.fn(),
  useWebhookDeliveries: vi.fn(),
  webhooksKeys: {
    all: ['webhooks'],
    detail: (id: string) => ['webhooks', id],
    deliveries: (webhookId: string) => ['webhooks', webhookId, 'deliveries'],
  },
}))

const mockedUseWebhooks = useWebhooks
const _mockedUseWebhook = useWebhook
const mockedUseCreateWebhook = useCreateWebhook
const mockedUseUpdateWebhook = useUpdateWebhook
const _mockedUseDeleteWebhook = useDeleteWebhook
const mockedUseTestWebhook = useTestWebhook
const mockedUseWebhookDeliveries = useWebhookDeliveries

vi.mock('@tanstack/react-router', () => {
  return {
    Link: ({ children, ...props }: { children: ReactNode; to: string }) => (
      <a href={props.to}>{children}</a>
    ),
    useNavigate: vi.fn().mockReturnValue(vi.fn()),
    useParams: vi.fn().mockReturnValue({ webhookId: 'webhook-1' }),
  }
})

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children, ...props }: { children: ReactNode; className?: string }) => (
    <main {...props}>{children}</main>
  ),
}))

vi.mock('@/components/search', () => ({
  Search: () => <div data-testid='search' />,
}))

vi.mock('@/components/theme-switch', () => ({
  ThemeSwitch: () => <div data-testid='theme-switch' />,
}))

vi.mock('@/components/config-drawer', () => ({
  ConfigDrawer: () => <div data-testid='config-drawer' />,
}))

vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => <div data-testid='profile-dropdown' />,
}))

vi.mock('./webhooks-table', () => ({
  WebhooksTable: ({ data }: { data: WebhookDefinition[] }) => (
    <div data-testid='webhooks-table'>{data.length} webhooks</div>
  ),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const mockWebhook: WebhookDefinition = {
  id: 'webhook-1',
  url: 'https://example.com/webhook',
  events: ['entry.created', 'entry.updated'],
  customHeaders: { 'X-Custom': 'value' },
  secret: 'secret-key',
  retryConfig: { maxRetries: 3, timeout: 5000 },
  status: 'enabled',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

const mockDelivery: WebhookDelivery = {
  id: 'delivery-1',
  webhookId: 'webhook-1',
  eventType: 'entry.created',
  status: 'delivered',
  responseStatusCode: 200,
  responseBody: '{"success": true}',
  retryCount: 0,
  createdAt: '2024-01-01T00:00:00Z',
  deliveredAt: '2024-01-01T00:00:01Z',
}

describe('WebhookList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state', () => {
    mockedUseWebhooks.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    render(<WebhookList />, { wrapper: createWrapper() })

    expect(screen.getByText('Webhooks')).toBeInTheDocument()
    expect(
      screen.getByText('Manage webhook endpoints and event subscriptions.')
    ).toBeInTheDocument()
  })

  it('renders webhook list when data is loaded', () => {
    mockedUseWebhooks.mockReturnValue({
      data: [mockWebhook],
      isLoading: false,
      error: null,
    } as never)

    render(<WebhookList />, { wrapper: createWrapper() })

    expect(screen.getByTestId('webhooks-table')).toHaveTextContent('1 webhooks')
  })

  it('shows create button', () => {
    mockedUseWebhooks.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as never)

    render(<WebhookList />, { wrapper: createWrapper() })

    expect(screen.getByText('Create Webhook')).toBeInTheDocument()
  })

  it('displays error state on fetch failure', () => {
    mockedUseWebhooks.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    } as never)

    render(<WebhookList />, { wrapper: createWrapper() })

    expect(screen.getByText('Failed to load webhooks. Please try again.')).toBeInTheDocument()
  })
})

describe('WebhookForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders create form with empty fields', () => {
    mockedUseCreateWebhook.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    render(<WebhookForm mode='create' />, { wrapper: createWrapper() })

    expect(screen.getByPlaceholderText('https://example.com/webhook')).toBeInTheDocument()
    expect(screen.getByText('Create Webhook')).toBeInTheDocument()
  })

  it('renders edit form with webhook data', () => {
    mockedUseUpdateWebhook.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)
    mockedUseTestWebhook.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    render(<WebhookForm mode='edit' webhook={mockWebhook} />, { wrapper: createWrapper() })

    expect(screen.getByDisplayValue('https://example.com/webhook')).toBeInTheDocument()
    expect(screen.getByText('Update Webhook')).toBeInTheDocument()
    expect(screen.getByText('Send Test Event')).toBeInTheDocument()
  })

  it('validates URL must be HTTPS', async () => {
    const user = userEvent.setup()
    mockedUseCreateWebhook.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    render(<WebhookForm mode='create' />, { wrapper: createWrapper() })

    const urlInput = screen.getByPlaceholderText('https://example.com/webhook')
    const submitButton = screen.getByText('Create Webhook')

    await user.type(urlInput, 'http://example.com/webhook')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('URL must use HTTPS')).toBeInTheDocument()
    })
  })

  it('validates at least one event must be selected', async () => {
    const user = userEvent.setup()
    mockedUseCreateWebhook.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    render(<WebhookForm mode='create' />, { wrapper: createWrapper() })

    const urlInput = screen.getByPlaceholderText('https://example.com/webhook')
    const submitButton = screen.getByText('Create Webhook')

    await user.type(urlInput, 'https://example.com/webhook')
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText('At least one event must be selected')).toBeInTheDocument()
    })
  })

  it('shows test delivery result on success', async () => {
    const user = userEvent.setup()
    const mockTestMutate = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: '{"success": true}',
      success: true,
    })

    mockedUseUpdateWebhook.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)
    mockedUseTestWebhook.mockReturnValue({
      mutateAsync: mockTestMutate,
      isPending: false,
    } as never)

    render(<WebhookForm mode='edit' webhook={mockWebhook} />, { wrapper: createWrapper() })

    const testButton = screen.getByText('Send Test Event')
    await user.click(testButton)

    await waitFor(() => {
      expect(screen.getByText('Status Code:')).toBeInTheDocument()
      expect(screen.getByText('200')).toBeInTheDocument()
      expect(screen.getByText('Response:')).toBeInTheDocument()
    })
  })

  it('allows adding custom headers', async () => {
    const user = userEvent.setup()
    mockedUseCreateWebhook.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as never)

    render(<WebhookForm mode='create' />, { wrapper: createWrapper() })

    const addHeaderButton = screen.getByText('Add Header')
    await user.click(addHeaderButton)

    expect(screen.getByPlaceholderText('Header name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Header value')).toBeInTheDocument()
  })
})

describe('DeliveryLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state', () => {
    mockedUseWebhookDeliveries.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as never)

    render(<DeliveryLog webhookId='webhook-1' />, { wrapper: createWrapper() })

    expect(screen.getByText('Delivery Log')).toBeInTheDocument()
  })

  it('renders empty state when no deliveries', () => {
    mockedUseWebhookDeliveries.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as never)

    render(<DeliveryLog webhookId='webhook-1' />, { wrapper: createWrapper() })

    expect(
      screen.getByText('No deliveries yet. This webhook has not been triggered.')
    ).toBeInTheDocument()
  })

  it('renders delivery list with status badges', () => {
    mockedUseWebhookDeliveries.mockReturnValue({
      data: [mockDelivery],
      isLoading: false,
      error: null,
    } as never)

    render(<DeliveryLog webhookId='webhook-1' />, { wrapper: createWrapper() })

    expect(screen.getByText('entry.created')).toBeInTheDocument()
    expect(screen.getByText('delivered')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
  })

  it('displays error state on fetch failure', () => {
    mockedUseWebhookDeliveries.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    } as never)

    render(<DeliveryLog webhookId='webhook-1' />, { wrapper: createWrapper() })

    expect(screen.getByText('Failed to load delivery logs. Please try again.')).toBeInTheDocument()
  })

  it('allows expanding rows to view response body', async () => {
    const user = userEvent.setup()
    mockedUseWebhookDeliveries.mockReturnValue({
      data: [mockDelivery],
      isLoading: false,
      error: null,
    } as never)

    render(<DeliveryLog webhookId='webhook-1' />, { wrapper: createWrapper() })

    const row = screen.getByText('entry.created').closest('tr')
    expect(row).toBeInTheDocument()
    if (!row) {
      throw new Error('Expected delivery row to be present')
    }

    await user.click(row)

    await waitFor(() => {
      expect(screen.getByText('Response Body:')).toBeInTheDocument()
      expect(screen.getByText('{"success": true}')).toBeInTheDocument()
    })
  })
})
