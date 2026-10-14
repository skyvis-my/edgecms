import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react'
import { ErrorBanner } from '@/components/error-banner'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ServiceMatrixCard } from './components/service-matrix-card'
import { TenantFleetSection } from './components/tenant-fleet-section'
import { setCurrentTenantSlug, useTenants } from '@/features/tenants/api'
import { edenGet } from '@/lib/eden-client'
import { buildTenantAdminUrl } from '@/lib/tenant-route'
import { cn } from '@/lib/utils'

type HealthSubsystemStatus = 'ok' | 'missing' | 'error'
type HealthSubsystem =
  | HealthSubsystemStatus
  | {
      status?: HealthSubsystemStatus
      latencyMs?: number
    }

type HealthStatus = {
  status: 'ok' | 'degraded' | 'unhealthy'
  timestamp: string
  version?: string
  subsystems: {
    database: HealthSubsystem
    cache: HealthSubsystem
    media: HealthSubsystem
    assets: HealthSubsystem
    scheduler: HealthSubsystem
    webhooks: HealthSubsystem
  }
}

type SystemStats = {
  collections: number
  entries: number
  publishedEntries: number
}

type AssetUsageSummary = {
  tenantId: string
  assetCount: number
  totalBytes: number
}

type WebhookStatusSummary = {
  total: number
  enabled: number
  failed: number
  pending: number
  delivered: number
}

type DashboardSummary = {
  stats: SystemStats
  webhooks: WebhookStatusSummary
  assets: AssetUsageSummary
}

function getSubsystemStatus(subsystem: HealthSubsystem | undefined) {
  if (!subsystem) return 'unknown'
  if (typeof subsystem === 'string') return subsystem
  return subsystem.status ?? 'unknown'
}

function getSubsystemLatencyLabel(subsystem: HealthSubsystem | undefined) {
  if (!subsystem || typeof subsystem === 'string' || typeof subsystem.latencyMs !== 'number') {
    return null
  }
  return `${subsystem.latencyMs}ms`
}

function getSubsystemLatencyMs(subsystem: HealthSubsystem | undefined) {
  if (!subsystem || typeof subsystem === 'string' || typeof subsystem.latencyMs !== 'number') {
    return null
  }
  return subsystem.latencyMs
}

function getHealthStatusLabel(status: HealthStatus['status'] | undefined) {
  if (status === 'ok') return 'Stable'
  if (status === 'degraded') return 'Degraded'
  if (status === 'unhealthy') return 'Unhealthy'
  return 'Unknown'
}

function getStatusBadgeVariant(status: string) {
  if (status === 'ok') return 'default'
  if (status === 'missing') return 'secondary'
  return 'destructive'
}

function getStatusTone(status: string) {
  if (status === 'ok') return 'text-emerald-500'
  if (status === 'missing') return 'text-amber-500'
  if (status === 'error') return 'text-destructive'
  return 'text-muted-foreground'
}

function formatRelativeTime(timestamp: string | undefined) {
  if (!timestamp) return 'No health sample yet'

  const sampledAt = new Date(timestamp).getTime()
  if (Number.isNaN(sampledAt)) return 'Invalid health timestamp'

  const diffSeconds = Math.max(0, Math.round((Date.now() - sampledAt) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s ago`

  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`

  const diffHours = Math.round(diffMinutes / 60)
  return `${diffHours}h ago`
}

function statusToScore(status: string) {
  if (status === 'ok') return 100
  if (status === 'missing') return 50
  if (status === 'error') return 0
  return 25
}

function scoreToReadiness(score: number) {
  if (score >= 90) return 'Production ready'
  if (score >= 70) return 'Watch closely'
  return 'Action required'
}

function getServiceAction(status: string) {
  if (status === 'ok') return 'No action'
  if (status === 'missing') return 'Bind resource'
  if (status === 'error') return 'Inspect worker logs'
  return 'Refresh health'
}

function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health')
      if (!res.ok) {
        throw new Error('Failed to fetch health status')
      }
      return res.json()
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
}

function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => edenGet<DashboardSummary>('/admin/system/dashboard'),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  })
}

function StatsCardSkeleton() {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <Skeleton className='h-4 w-24' />
        <Skeleton className='h-4 w-4' />
      </CardHeader>
      <CardContent>
        <Skeleton className='mb-1 h-7 w-16' />
        <Skeleton className='h-3 w-32' />
      </CardContent>
    </Card>
  )
}

function TenantCardSkeleton() {
  return (
    <Card>
      <CardHeader className='pb-3'>
        <Skeleton className='h-5 w-32' />
      </CardHeader>
      <CardContent className='space-y-2'>
        <Skeleton className='h-4 w-24' />
        <Skeleton className='h-4 w-20' />
        <Skeleton className='h-4 w-16' />
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const { data: tenants, isLoading: tenantsLoading, error: tenantsError } = useTenants()
  const { data: health, isLoading: healthLoading, error: healthError } = useHealth()
  const {
    data: dashboardSummary,
    isLoading: summaryLoading,
    error: summaryError,
  } = useDashboardSummary()

  const systemStats = dashboardSummary?.stats
  const webhooks = dashboardSummary?.webhooks
  const assetUsage = dashboardSummary?.assets ? [dashboardSummary.assets] : undefined
  const statsLoading = summaryLoading
  const webhooksLoading = summaryLoading
  const assetUsageLoading = summaryLoading
  const statsError = summaryError
  const webhooksError = summaryError
  const assetUsageError = summaryError

  const totalTenants = tenants?.length ?? 0
  const activeTenants = tenants?.filter((t) => t.status === 'active').length ?? 0
  const suspendedTenants = tenants?.filter((t) => t.status === 'suspended').length ?? 0
  const totalTenantUsers = tenants?.reduce((total, tenant) => total + (tenant.userCount ?? 0), 0) ?? 0
  const tenantCoverage = totalTenants > 0 ? Math.round((activeTenants / totalTenants) * 100) : 0
  const tenantRiskCount = totalTenants - activeTenants
  const assetUsageByTenantId = new Map((assetUsage ?? []).map((usage) => [usage.tenantId, usage]))
  const totalMediaBytes = assetUsage?.reduce((total, usage) => total + usage.totalBytes, 0) ?? 0
  const totalMediaAssets = assetUsage?.reduce((total, usage) => total + usage.assetCount, 0) ?? 0
  const publishedEntries = systemStats?.publishedEntries ?? 0
  const totalEntries = systemStats?.entries ?? 0
  const collectionCount = systemStats?.collections ?? 0
  const publishCoverage = totalEntries > 0 ? Math.round((publishedEntries / totalEntries) * 100) : 0
  const webhookCount = webhooks?.total ?? 0
  const enabledWebhooks = webhooks?.enabled ?? 0
  const failedWebhooks = webhooks?.failed ?? 0
  const pendingWebhooks = webhooks?.pending ?? 0
  const deliveredWebhooks = webhooks?.delivered ?? 0
  const staleTelemetryIssues = [summaryError, healthError].filter(Boolean).length
  const topTenants = tenants
    ?.slice()
    .sort((a, b) => (b.userCount ?? 0) - (a.userCount ?? 0))
    .slice(0, 6)

  const serviceRows = [
    {
      key: 'database',
      name: 'D1 database',
      owner: 'Persistence',
      binding: 'DB',
      icon: Database,
      subsystem: health?.subsystems.database,
      detail: 'Tenant metadata and CMS records',
    },
    {
      key: 'cache',
      name: 'KV cache',
      owner: 'Edge cache',
      binding: 'CACHE',
      icon: Zap,
      subsystem: health?.subsystems.cache,
      detail: 'Low-latency cached reads',
    },
    {
      key: 'media',
      name: 'Media bucket',
      owner: 'Asset storage',
      binding: 'MEDIA',
      icon: HardDrive,
      subsystem: health?.subsystems.media,
      detail: 'Original uploaded media',
    },
    {
      key: 'assets',
      name: 'Static assets',
      owner: 'Admin delivery',
      binding: 'ASSETS',
      icon: Server,
      subsystem: health?.subsystems.assets,
      detail: 'Built admin SPA assets',
    },
    {
      key: 'scheduler',
      name: 'Publish scheduler',
      owner: 'Automation',
      binding: 'PUBLISH_SCHEDULER',
      icon: Clock,
      subsystem: health?.subsystems.scheduler,
      detail: 'Durable Object scheduled publishing',
    },
    {
      key: 'webhooks',
      name: 'Webhook queue',
      owner: 'Delivery',
      binding: 'WEBHOOK_QUEUE',
      icon: Radio,
      subsystem: health?.subsystems.webhooks,
      detail: 'Async webhook fan-out',
    },
  ].map((service) => ({
    ...service,
    status: getSubsystemStatus(service.subsystem),
    latencyLabel: getSubsystemLatencyLabel(service.subsystem),
    latencyMs: getSubsystemLatencyMs(service.subsystem),
  }))

  const healthyServices = serviceRows.filter((service) => service.status === 'ok').length
  const degradedServices = serviceRows.filter((service) => service.status !== 'ok')
  const readinessScore =
    serviceRows.length > 0
      ? Math.round(
          serviceRows.reduce((total, service) => total + statusToScore(service.status), 0) /
            serviceRows.length
        )
      : 0
  const slowestService = serviceRows
    .filter((service) => typeof service.latencyMs === 'number')
    .sort((a, b) => (b.latencyMs ?? 0) - (a.latencyMs ?? 0))[0]
  const systemLabel = getHealthStatusLabel(health?.status)
  const freshnessLabel = formatRelativeTime(health?.timestamp)
  const openIssueCount =
    degradedServices.length + tenantRiskCount + failedWebhooks + pendingWebhooks + staleTelemetryIssues
  const issueRows = [
    ...degradedServices.map((service) => ({
      key: service.key,
      label: service.name,
      detail: `${service.binding} reports ${service.status}`,
      tone: getStatusTone(service.status),
    })),
    ...(failedWebhooks > 0
      ? [
          {
            key: 'webhook-failures',
            label: 'Webhook failures',
            detail: `${failedWebhooks} destination last delivery failed`,
            tone: 'text-destructive',
          },
        ]
      : []),
    ...(staleTelemetryIssues > 0
      ? [
          {
            key: 'telemetry-errors',
            label: 'Telemetry fetch errors',
            detail: `${staleTelemetryIssues} dashboard source unavailable`,
            tone: 'text-amber-500',
          },
        ]
      : []),
  ]

  const openTenantWorkspace = (tenantSlug: string) => {
    setCurrentTenantSlug(tenantSlug)
    window.location.assign(buildTenantAdminUrl(tenantSlug))
  }

  return (
    <>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Infrastructure Command Center</h2>
            <p className='text-muted-foreground'>
              Health, bindings, tenant fleet, and delivery readiness for this EdgeCMS instance.
            </p>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Badge variant='outline' className='gap-1'>
              <RefreshCw className='h-3.5 w-3.5' />
              Health {freshnessLabel}
            </Badge>
            {health?.version && <Badge variant='secondary'>API {health.version}</Badge>}
          </div>
        </div>

        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {healthLoading ? (
            <StatsCardSkeleton />
          ) : (
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>Readiness Score</CardTitle>
                <ShieldCheck className='h-4 w-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='flex items-end gap-2'>
                  <div className='text-3xl font-bold'>{readinessScore}</div>
                  <span className='pb-1 text-sm text-muted-foreground'>/ 100</span>
                </div>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {scoreToReadiness(readinessScore)} based on {serviceRows.length} edge bindings
                </p>
                <div className='mt-3 h-2 rounded-full bg-muted'>
                  <div
                    className={cn(
                      'h-2 rounded-full',
                      readinessScore >= 90
                        ? 'bg-emerald-500'
                        : readinessScore >= 70
                          ? 'bg-amber-500'
                          : 'bg-destructive'
                    )}
                    style={{ width: `${readinessScore}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {healthLoading ? (
            <StatsCardSkeleton />
          ) : (
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>System Pulse</CardTitle>
                <Activity className='h-4 w-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='flex items-center gap-2'>
                  <div className='text-2xl font-bold'>{systemLabel}</div>
                  {health?.status && (
                    <Badge variant={health.status === 'ok' ? 'default' : 'destructive'}>
                      {health.status}
                    </Badge>
                  )}
                </div>
                <p className='text-xs text-muted-foreground'>
                  {healthyServices} healthy, {degradedServices.length} need attention
                </p>
              </CardContent>
            </Card>
          )}

          {healthLoading ? (
            <StatsCardSkeleton />
          ) : (
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>Dependency Coverage</CardTitle>
                <CheckCircle2 className='h-4 w-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold'>
                  {healthyServices}/{serviceRows.length}
                </div>
                <p className='text-xs text-muted-foreground'>
                  Required Cloudflare bindings responding
                </p>
              </CardContent>
            </Card>
          )}

          {statsLoading ? (
            <StatsCardSkeleton />
          ) : (
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>Content Usage</CardTitle>
                <Database className='h-4 w-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='flex items-end gap-2'>
                  <div className='text-2xl font-bold'>{totalEntries}</div>
                  <span className='pb-0.5 text-sm text-muted-foreground'>entries</span>
                </div>
                <p className='text-xs text-muted-foreground'>
                  {collectionCount} collections, {publishCoverage}% published
                </p>
              </CardContent>
            </Card>
          )}

          {webhooksLoading ? (
            <StatsCardSkeleton />
          ) : (
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>Issues & Errors</CardTitle>
                <AlertTriangle className='h-4 w-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='flex items-center gap-2'>
                  <div className='text-2xl font-bold'>{openIssueCount}</div>
                  <Badge variant={openIssueCount === 0 ? 'default' : 'destructive'}>
                    {openIssueCount === 0 ? 'Clear' : 'Review'}
                  </Badge>
                </div>
                <p className='text-xs text-muted-foreground'>
                  {failedWebhooks} failed webhook, {pendingWebhooks} pending,{' '}
                  {degradedServices.length} infra flagged
                </p>
              </CardContent>
            </Card>
          )}

          {tenantsLoading ? (
            <StatsCardSkeleton />
          ) : (
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>Tenant Fleet</CardTitle>
                <Users className='h-4 w-4 text-muted-foreground' />
              </CardHeader>
              <CardContent>
                <div className='flex items-end gap-2'>
                  <div className='text-2xl font-bold'>{activeTenants}</div>
                  <span className='pb-0.5 text-sm text-muted-foreground'>active</span>
                </div>
                <p className='text-xs text-muted-foreground'>
                  {tenantCoverage}% active across {totalTenants} tenants, {totalTenantUsers} users
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {healthError && (
          <ErrorBanner message='Failed to fetch system health. The API may be unavailable.' />
        )}
        {statsError && (
          <ErrorBanner message='Failed to fetch content usage stats. Usage telemetry may be stale.' />
        )}
        {webhooksError && (
          <ErrorBanner message='Failed to fetch webhook status. Delivery issue count may be incomplete.' />
        )}
        {assetUsageError && (
          <ErrorBanner message='Failed to fetch media usage. Tenant storage totals may be stale.' />
        )}

        <div className='grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]'>
          <ServiceMatrixCard
            serviceRows={serviceRows}
            degradedServicesCount={degradedServices.length}
            healthLoading={healthLoading}
            getStatusTone={getStatusTone}
            getStatusBadgeVariant={getStatusBadgeVariant}
            getServiceAction={getServiceAction}
          />

          <div className='grid gap-4'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Ops Summary</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='rounded-md border p-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-sm font-medium'>Freshness</span>
                    <Badge variant='outline'>{freshnessLabel}</Badge>
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Health refetches every 60s; stale probes reduce trust in green status.
                  </p>
                </div>
                <div className='rounded-md border p-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-sm font-medium'>Slowest Probe</span>
                    <span className='text-sm'>
                      {slowestService
                        ? `${slowestService.name} ${slowestService.latencyLabel}`
                        : 'No latency samples'}
                    </span>
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    D1 and KV probes are real operations; R2, assets, scheduler, and queue are binding checks.
                  </p>
                </div>
                <div className='rounded-md border p-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-sm font-medium'>Usage</span>
                    <Badge variant='outline'>{totalEntries} entries</Badge>
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {publishedEntries} published entries across {collectionCount} collections.
                    Publish coverage: {publishCoverage}%.
                  </p>
                </div>
                <div className='rounded-md border p-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-sm font-medium'>Issue Load</span>
                    <Badge variant={openIssueCount === 0 ? 'default' : 'destructive'}>
                      {openIssueCount === 0 ? 'Clear' : `${openIssueCount} open`}
                    </Badge>
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Includes degraded infra, non-active tenants, webhook delivery issues, and telemetry
                    fetch errors.
                  </p>
                </div>
                <div className='rounded-md border p-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-sm font-medium'>Tenant Risk</span>
                    <Badge variant={tenantRiskCount === 0 ? 'default' : 'destructive'}>
                      {tenantRiskCount === 0 ? 'None' : `${tenantRiskCount} non-active`}
                    </Badge>
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Suspended tenants: {suspendedTenants}. Active tenant coverage: {tenantCoverage}%.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='text-base'>Next Actions</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                {healthLoading ? (
                  <>
                    <Skeleton className='h-12 w-full' />
                    <Skeleton className='h-12 w-full' />
                  </>
                ) : openIssueCount === 0 ? (
                  <div className='flex items-start gap-3 rounded-md border border-emerald-500/30 p-3'>
                    <CheckCircle2 className='mt-0.5 h-4 w-4 text-emerald-500' />
                    <div>
                      <div className='text-sm font-medium'>No infra action required</div>
                      <p className='text-xs text-muted-foreground'>
                        All configured dependencies are present and responding in the latest sample.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {degradedServices.map((service) => (
                      <div key={service.key} className='flex items-start gap-3 rounded-md border p-3'>
                        <AlertTriangle className={cn('mt-0.5 h-4 w-4', getStatusTone(service.status))} />
                        <div>
                          <div className='text-sm font-medium'>
                            {service.name}: {getServiceAction(service.status)}
                          </div>
                          <p className='text-xs text-muted-foreground'>
                            {service.binding} reports {service.status}. {service.detail}.
                          </p>
                        </div>
                      </div>
                    ))}
                    {failedWebhooks > 0 && (
                      <div className='flex items-start gap-3 rounded-md border p-3'>
                        <AlertTriangle className='mt-0.5 h-4 w-4 text-destructive' />
                        <div>
                          <div className='text-sm font-medium'>Webhook delivery failures</div>
                          <p className='text-xs text-muted-foreground'>
                            {failedWebhooks} webhook destinations report failed last delivery.
                          </p>
                        </div>
                      </div>
                    )}
                    {pendingWebhooks > 0 && (
                      <div className='flex items-start gap-3 rounded-md border p-3'>
                        <Clock className='mt-0.5 h-4 w-4 text-amber-500' />
                        <div>
                          <div className='text-sm font-medium'>Webhook deliveries pending</div>
                          <p className='text-xs text-muted-foreground'>
                            {pendingWebhooks} webhook destinations have delivery still pending.
                          </p>
                        </div>
                      </div>
                    )}
                    {tenantRiskCount > 0 && (
                      <div className='flex items-start gap-3 rounded-md border p-3'>
                        <Users className='mt-0.5 h-4 w-4 text-amber-500' />
                        <div>
                          <div className='text-sm font-medium'>Tenant access review</div>
                          <p className='text-xs text-muted-foreground'>
                            {tenantRiskCount} tenant workspaces are not active.
                          </p>
                        </div>
                      </div>
                    )}
                    {staleTelemetryIssues > 0 && (
                      <div className='flex items-start gap-3 rounded-md border p-3'>
                        <RefreshCw className='mt-0.5 h-4 w-4 text-amber-500' />
                        <div>
                          <div className='text-sm font-medium'>Telemetry unavailable</div>
                          <p className='text-xs text-muted-foreground'>
                            {staleTelemetryIssues} dashboard data source failed to load.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className='grid gap-4 lg:grid-cols-3'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Usage Detail</CardTitle>
              <p className='text-sm text-muted-foreground'>
                Content volume and publishing shape from admin system stats.
              </p>
            </CardHeader>
            <CardContent className='space-y-3'>
              {statsLoading ? (
                <>
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                </>
              ) : (
                <>
                  <div className='flex items-center justify-between rounded-md border p-3'>
                    <span className='text-sm font-medium'>Collections</span>
                    <span className='text-sm'>{collectionCount}</span>
                  </div>
                  <div className='flex items-center justify-between rounded-md border p-3'>
                    <span className='text-sm font-medium'>Entries</span>
                    <span className='text-sm'>{totalEntries}</span>
                  </div>
                  <div className='flex items-center justify-between rounded-md border p-3'>
                    <span className='text-sm font-medium'>Published</span>
                    <span className='text-sm'>
                      {publishedEntries} ({publishCoverage}%)
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Delivery Issues</CardTitle>
              <p className='text-sm text-muted-foreground'>
                Webhook last-delivery status across configured destinations.
              </p>
            </CardHeader>
            <CardContent className='space-y-3'>
              {webhooksLoading ? (
                <>
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                </>
              ) : (
                <>
                  <div className='flex items-center justify-between rounded-md border p-3'>
                    <span className='text-sm font-medium'>Enabled webhooks</span>
                    <span className='text-sm'>
                      {enabledWebhooks}/{webhookCount}
                    </span>
                  </div>
                  <div className='flex items-center justify-between rounded-md border p-3'>
                    <span className='text-sm font-medium'>Delivered last run</span>
                    <Badge variant='outline'>{deliveredWebhooks}</Badge>
                  </div>
                  <div className='flex items-center justify-between rounded-md border p-3'>
                    <span className='text-sm font-medium'>Failed or pending</span>
                    <Badge variant={failedWebhooks + pendingWebhooks === 0 ? 'default' : 'destructive'}>
                      {failedWebhooks + pendingWebhooks}
                    </Badge>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Recent Errors</CardTitle>
              <p className='text-sm text-muted-foreground'>
                Current dashboard-visible error sources.
              </p>
            </CardHeader>
            <CardContent className='space-y-3'>
              {issueRows.length === 0 ? (
                <div className='flex items-start gap-3 rounded-md border border-emerald-500/30 p-3'>
                  <CheckCircle2 className='mt-0.5 h-4 w-4 text-emerald-500' />
                  <div>
                    <div className='text-sm font-medium'>No current errors</div>
                    <p className='text-xs text-muted-foreground'>
                      Health probes and delivery summaries show no active error state.
                    </p>
                  </div>
                </div>
              ) : (
                issueRows.map((issue) => (
                  <div key={issue.key} className='flex items-start gap-3 rounded-md border p-3'>
                    <AlertTriangle className={cn('mt-0.5 h-4 w-4', issue.tone)} />
                    <div>
                      <div className='text-sm font-medium'>{issue.label}</div>
                      <p className='text-xs text-muted-foreground'>{issue.detail}</p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <TenantFleetSection
          tenants={tenants}
          topTenants={topTenants}
          tenantsLoading={tenantsLoading}
          tenantsError={tenantsError}
          totalTenantUsers={totalTenantUsers}
          totalMediaBytes={totalMediaBytes}
          totalMediaAssets={totalMediaAssets}
          assetUsageLoading={assetUsageLoading}
          assetUsageByTenantId={assetUsageByTenantId}
          openTenantWorkspace={openTenantWorkspace}
          TenantCardSkeleton={TenantCardSkeleton}
        />
      </Main>
    </>
  )
}
