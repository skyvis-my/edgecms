import { Elysia, type AnyElysia } from 'elysia'
import { aiController } from '@/ai/ai.controller'
import { assetsController } from '@/assets/assets.controller'
import { cacheStatsController } from '@/cache/cache-stats.controller'
import { collectionsController } from '@/collections/collections.controller'
import { commandsController } from '@/commands/commands.controller'
import { entriesController } from '@/entries/entries.controller'
import { graphqlController } from '@/graphql/graphql.controller'
import { mcpController } from '@/mcp/mcp.controller'
import { publicController } from '@/public/public.controller'
import { relationsController } from '@/relations/relations.controller'
import { syncController } from '@/sync/sync.controller'
import { systemController } from '@/system/system.controller'
import { usersController } from '@/users/users.controller'
import { versioningController } from '@/versioning/versioning.controller'
import { webhooksController } from '@/webhooks/webhooks.controller'

export type CoreApiRoutesOptions = {
  scopedPluginsController: AnyElysia
  scopedPluginRoutesController: AnyElysia
}

/**
 * Composable plugin bundling the core EdgeCMS controllers.
 * Used for both global routes and tenant-scoped route groups.
 */
export function createCoreApiRoutes(options: CoreApiRoutesOptions) {
  return new Elysia({ name: 'core-api-routes' })
    .use(publicController)
    .use(graphqlController)
    .use(assetsController)
    .use(aiController)
    .use(collectionsController)
    .use(commandsController)
    .use(entriesController)
    .use(options.scopedPluginsController)
    .use(options.scopedPluginRoutesController)
    .use(relationsController)
    .use(syncController)
    .use(usersController)
    .use(versioningController)
    .use(cacheStatsController)
    .use(systemController)
    .use(webhooksController)
    .use(mcpController)
}
