import type { PluginDefinition } from '@edgecms/plugin-sdk'

/**
 * EX-02 example: a plugin that declares its full contract. It is not in the
 * trusted catalog; copy the shape into `trusted-plugin-catalog.ts` to use it.
 *
 * At composition the API loader checks that:
 * - the running EdgeCMS version satisfies `edgecms`;
 * - `audit-trace` is enabled from the trusted catalog at a version in `^1.0.0`
 *   (it then loads, and runs its hooks, before this plugin);
 * - the Worker env has an R2 bucket bound as `MEDIA` and a non-empty
 *   `RENDITION_SIGNING_SECRET`.
 *
 * If any check fails, this plugin registers nothing and
 * `GET /api/admin/plugins` reports it `blocked` with every issue.
 */
export const mediaRenditionsPlugin = {
  metadata: {
    displayName: 'Media Renditions',
    description: 'Illustrative plugin showing the EX-02 contract fields.',
    version: '0.1.0',
    category: 'media',
    permissions: ['media:read'],
  },
  edgecms: '>=0.2.0 <1.0.0',
  dependencies: {
    'audit-trace': '^1.0.0',
  },
  bindings: [
    { name: 'MEDIA', kind: 'r2', description: 'reads originals' },
    { name: 'RENDITION_SIGNING_SECRET', kind: 'secret', description: 'signs rendition URLs' },
  ],
  hooks: {
    afterCommand: async (ctx) => {
      void ctx.commandType
    },
  },
} satisfies PluginDefinition
