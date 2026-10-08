import type { Type } from 'arktype'
import { type } from 'arktype'
import { Elysia } from 'elysia'
import { id } from '@/shared/schemas'
import type { EventType } from '@/webhooks/event-bus'
import { signPayload } from '@/webhooks/webhook-delivery.service'
import { validateWebhookDestination } from '@/webhooks/webhook-destination-policy'
import type {
  PluginAdminMenuItem,
  PluginAiTool,
  PluginDefinition,
  PluginFieldType,
  PluginGeneratedCommand,
  PluginHook,
  PluginMetadata,
  PluginRouteFactory,
} from '@edgecms/plugin-sdk'
import type { CommandEnvelope } from '@edgecms/schemas/commands'

export type PluginAiGeneratedCommand = PluginGeneratedCommand<CommandEnvelope['type']>

export type AnyElysia = Elysia<any, any, any, any, any, any, any>

export type TrustedPluginAiTool = PluginAiTool<PluginAiGeneratedCommand, Type>

export type TrustedPluginRouteFactory = PluginRouteFactory<AnyElysia>

export type TrustedPluginFieldType = PluginFieldType<Type>

export type TrustedPluginMetadata = PluginMetadata

export type TrustedPluginAdminMenuItem = PluginAdminMenuItem

export type TrustedPluginDefinition = PluginDefinition<AnyElysia, PluginAiGeneratedCommand, Type>


const noopHook: PluginHook = async () => {}
const pluginUpdateEntryTool: TrustedPluginAiTool = {
  name: 'pluginUpdateEntry',
  description: 'Update a single entry payload through plugin-extensible AI routing.',
  parameters: type({
    id,
    data: 'Record<string, unknown>',
  }),
  toCommands: (args) => [
    {
      type: 'updateEntry',
      payload: args,
    },
  ],
}

const pluginGenerateSeoMetadataTool: TrustedPluginAiTool = {
  name: 'pluginGenerateSeoMetadata',
  description: 'Generate SEO title, description, and keywords for an entry',
  parameters: type({
    entryId: id,
    collectionSlug: 'string',
  }),
  toCommands: (args) => [
    {
      type: 'updateEntry',
      payload: {
        entryId: args.entryId,
        data: {
          seoTitle: `[AI-generated]`,
          seoDescription: `[AI-generated]`,
          seoKeywords: `[AI-generated]`,
        },
      },
    },
  ],
}

type PreviewRevalidationDryRunBody = {
  destination?: unknown
  secret?: unknown
  path?: unknown
  event?: unknown
  tenantScope?: unknown
  contentId?: unknown
}

function parsePreviewRevalidationDryRun(body: unknown) {
  const input = (body ?? {}) as PreviewRevalidationDryRunBody
  if (typeof input.destination !== 'string' || input.destination.trim().length === 0) {
    return { error: 'Destination URL is required' }
  }
  if (typeof input.secret !== 'string' || input.secret.trim().length === 0) {
    return { error: 'Signing secret is required' }
  }
  if (typeof input.path !== 'string' || !input.path.startsWith('/')) {
    return { error: 'Path must start with /' }
  }

  const event =
    typeof input.event === 'string' && input.event.length > 0
      ? (input.event as EventType)
      : ('entry.published' as EventType)

  return {
    value: {
      destination: input.destination.trim(),
      secret: input.secret,
      payload: {
        event,
        path: input.path,
        tenantScope: typeof input.tenantScope === 'string' ? input.tenantScope : undefined,
        contentId: typeof input.contentId === 'string' ? input.contentId : undefined,
      },
    },
  }
}

// Only plugins listed here are allowed to register runtime hooks.
const trustedPluginCatalog: Record<string, TrustedPluginDefinition> = {
  'audit-trace': {
    metadata: {
      displayName: 'Audit Trace',
      description: 'Records command lifecycle hooks for operational audit visibility.',
      version: '1.0.0',
      category: 'operations',
      permissions: ['commands:read'],
    },
    hooks: {
      beforeCommand: noopHook,
      afterCommand: noopHook,
      beforeAiCommand: noopHook,
    },
    aiTools: [pluginUpdateEntryTool],
    adminMenu: [
      {
        label: 'Audit Trace',
        path: '/settings/plugins/audit-trace',
        group: 'Operations',
      },
    ],
    routes: {
      health: () =>
        new Elysia().get('/api/admin/plugins/audit-trace/health', () => ({
          success: true as const,
          data: { plugin: 'audit-trace', status: 'ok' as const },
        })) as AnyElysia,
    },
  },
  'seo-metadata': {
    metadata: {
      displayName: 'SEO Metadata',
      description: 'Adds SEO metadata tooling and field support for content entries.',
      version: '1.0.0',
      category: 'content',
      permissions: ['entries:update'],
    },
    hooks: {
      beforeCommand: async (_ctx) => {
        // Auto-generate slug from title if missing on createEntry
        // Note: This is a placeholder - actual slug generation would need
        // access to the command payload via a different mechanism
      },
    },
    aiTools: [pluginGenerateSeoMetadataTool],
    adminMenu: [
      {
        label: 'SEO Metadata',
        path: '/settings/plugins/seo-metadata',
        group: 'Content',
      },
    ],
    fields: [
      {
        type: 'seo-preview',
        label: 'SEO Preview',
        validator: type({
          title: 'string',
          description: 'string',
          url: 'string',
        }),
        defaultValue: { title: '', description: '', url: '' },
      },
    ],
    routes: {
      health: () =>
        new Elysia().get('/api/admin/plugins/seo-metadata/health', () => ({
          success: true as const,
          data: { plugin: 'seo-metadata', status: 'healthy' as const },
        })) as AnyElysia,
    },
  },
  'preview-revalidation': {
    metadata: {
      displayName: 'Preview Revalidation',
      description: 'Dry-runs signed frontend cache revalidation for publish events.',
      version: '1.0.0',
      category: 'delivery',
      permissions: ['webhooks:send'],
    },
    hooks: {
      afterCommand: noopHook,
    },
    adminMenu: [
      {
        label: 'Preview Revalidation',
        path: '/settings/plugins/preview-revalidation',
        group: 'Delivery',
      },
    ],
    routes: {
      health: () =>
        new Elysia().get('/api/admin/plugins/preview-revalidation/health', () => ({
          success: true as const,
          data: { plugin: 'preview-revalidation', status: 'healthy' as const },
        })) as AnyElysia,
      dryRun: () =>
        new Elysia().post('/api/admin/plugins/preview-revalidation/dry-run', async ({ body, set }) => {
          const parsed = parsePreviewRevalidationDryRun(body)
          if ('error' in parsed) {
            set.status = 400
            return { success: false as const, error: parsed.error }
          }

          const destination = validateWebhookDestination(parsed.value.destination)
          if (!destination.valid) {
            set.status = 400
            return { success: false as const, error: destination.error }
          }

          const headers = await signPayload(parsed.value.secret, parsed.value.payload)
          return {
            success: true as const,
            data: {
              destination: parsed.value.destination,
              method: 'POST' as const,
              headers,
              payload: parsed.value.payload,
            },
          }
        }) as AnyElysia,
    },
  },
}

export function getTrustedPluginDefinition(name: string): TrustedPluginDefinition | undefined {
  return trustedPluginCatalog[name]
}
