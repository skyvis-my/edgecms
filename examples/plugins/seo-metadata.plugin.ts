import type {
  PluginDefinition,
  PluginGeneratedCommand,
  PluginHealthResponse,
  PluginRouteDescriptor,
} from '@edgecms/plugin-sdk'

type SeoMetadataCommand = PluginGeneratedCommand<
  'updateEntry',
  {
    entryId?: unknown
    data: {
      seoTitle: string
      seoDescription: string
      seoKeywords: string
    }
  }
>

type SeoMetadataRoute = {
  method: 'GET'
  path: '/api/admin/plugins/seo-metadata/health'
  handle: () => PluginHealthResponse<'seo-metadata'>
}

type SeoMetadataSchema = {
  readonly type: 'object'
  readonly required: readonly string[]
}

const seoToolParameters = {
  type: 'object',
  required: ['entryId', 'collectionSlug'],
} as const satisfies SeoMetadataSchema

export const seoMetadataRoutes = [
  {
    name: 'health',
    kind: 'admin',
    path: '/api/admin/plugins/seo-metadata/health',
  },
] satisfies PluginRouteDescriptor<'seo-metadata'>[]

export const seoMetadataPlugin = {
  metadata: {
    displayName: 'SEO Metadata',
    description: 'Adds SEO metadata tooling and field support for content entries.',
    version: '1.0.0',
    category: 'content',
    permissions: ['entries:update'],
  },
  hooks: {
    beforeCommand: async (ctx) => {
      void ctx.commandType
    },
  },
  aiTools: [
    {
      name: 'pluginGenerateSeoMetadata',
      description: 'Generate SEO metadata for an entry.',
      parameters: seoToolParameters,
      toCommands: (args) => [
        {
          type: 'updateEntry',
          payload: {
            entryId: args.entryId,
            data: {
              seoTitle: '[AI-generated]',
              seoDescription: '[AI-generated]',
              seoKeywords: '[AI-generated]',
            },
          },
        },
      ],
    },
  ],
  fields: [
    {
      type: 'seo-preview',
      label: 'SEO Preview',
      validator: seoToolParameters,
      defaultValue: { title: '', description: '', url: '' },
    },
  ],
  routes: {
    health: () =>
      ({
        method: 'GET',
        path: '/api/admin/plugins/seo-metadata/health',
        handle: () => ({
          success: true,
          data: { plugin: 'seo-metadata', status: 'healthy' },
        }),
      }) satisfies SeoMetadataRoute,
  },
  adminMenu: [
    {
      label: 'SEO Metadata',
      path: '/settings/plugins/seo-metadata',
      group: 'Content',
    },
  ],
} satisfies PluginDefinition<SeoMetadataRoute, SeoMetadataCommand, SeoMetadataSchema>
