import type {
  PluginDefinition,
  PluginHealthResponse,
  PluginRouteDescriptor,
} from '@edgecms/plugin-sdk'

type AuditTraceRoute = {
  method: 'GET'
  path: '/api/admin/plugins/audit-trace/health'
  handle: () => PluginHealthResponse<'audit-trace'>
}

export const auditTraceRoutes = [
  {
    name: 'health',
    kind: 'admin',
    path: '/api/admin/plugins/audit-trace/health',
  },
] satisfies PluginRouteDescriptor<'audit-trace'>[]

export const auditTracePlugin = {
  metadata: {
    displayName: 'Audit Trace',
    description: 'Records command lifecycle hooks for operational audit visibility.',
    version: '1.0.0',
    category: 'operations',
    permissions: ['commands:read'],
  },
  hooks: {
    beforeCommand: async (ctx) => {
      void ctx.requestId
      void ctx.tenantScope
    },
    afterCommand: async (ctx) => {
      void ctx.commandStatus
    },
    beforeAiCommand: async (ctx) => {
      void ctx.prompt
    },
  },
  routes: {
    health: () =>
      ({
        method: 'GET',
        path: '/api/admin/plugins/audit-trace/health',
        handle: () => ({
          success: true,
          data: { plugin: 'audit-trace', status: 'ok' },
        }),
      }) satisfies AuditTraceRoute,
  },
  adminMenu: [
    {
      label: 'Audit Trace',
      path: '/settings/plugins/audit-trace',
      group: 'Operations',
    },
  ],
} satisfies PluginDefinition<AuditTraceRoute>
