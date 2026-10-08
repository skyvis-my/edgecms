import type {
  PluginDefinition,
  PluginHealthResponse,
  PluginPreviewRevalidationPayload,
  PluginRouteDescriptor,
  PluginSignedRevalidationRequest,
} from '@edgecms/plugin-sdk'

type PreviewRevalidationHealthRoute = {
  method: 'GET'
  path: '/api/admin/plugins/preview-revalidation/health'
  handle: () => PluginHealthResponse<'preview-revalidation'>
}

type PreviewRevalidationDryRunRoute = {
  method: 'POST'
  path: '/api/admin/plugins/preview-revalidation/dry-run'
  handle: (body: {
    destination: string
    secret: string
    path: string
    event?: PluginPreviewRevalidationPayload['event']
  }) => Promise<PluginSignedRevalidationRequest>
}

type PreviewRevalidationRoute =
  | PreviewRevalidationHealthRoute
  | PreviewRevalidationDryRunRoute

export const previewRevalidationRoutes = [
  {
    name: 'health',
    kind: 'admin',
    path: '/api/admin/plugins/preview-revalidation/health',
  },
  {
    name: 'dryRun',
    kind: 'admin',
    path: '/api/admin/plugins/preview-revalidation/dry-run',
  },
] satisfies PluginRouteDescriptor<'preview-revalidation'>[]

export const previewRevalidationPlugin = {
  metadata: {
    displayName: 'Preview Revalidation',
    description: 'Signs frontend cache revalidation requests after publish events.',
    version: '1.0.0',
    category: 'delivery',
    permissions: ['webhooks:send'],
  },
  hooks: {
    afterCommand: async (ctx) => {
      void ctx.commandStatus
      void ctx.commandType
      void ctx.tenantScope
    },
  },
  routes: {
    health: () =>
      ({
        method: 'GET',
        path: '/api/admin/plugins/preview-revalidation/health',
        handle: () => ({
          success: true,
          data: { plugin: 'preview-revalidation', status: 'healthy' },
        }),
      }) satisfies PreviewRevalidationHealthRoute,
    dryRun: () =>
      ({
        method: 'POST',
        path: '/api/admin/plugins/preview-revalidation/dry-run',
        handle: async (body) => ({
          destination: body.destination,
          method: 'POST',
          headers: {
            'x-edgecms-signature': 'sha256=<computed-by-api-runtime>',
            'x-webhook-signature': 'sha256=<computed-by-api-runtime>',
          },
          payload: {
            event: body.event ?? 'entry.published',
            path: body.path,
          },
        }),
      }) satisfies PreviewRevalidationDryRunRoute,
  },
  adminMenu: [
    {
      label: 'Preview Revalidation',
      path: '/settings/plugins/preview-revalidation',
      group: 'Delivery',
    },
  ],
} satisfies PluginDefinition<PreviewRevalidationRoute>
