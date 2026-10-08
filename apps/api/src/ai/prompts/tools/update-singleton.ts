import { type } from 'arktype'
import { id } from '@/shared/schemas'

/**
 * AI tool for updating a singleton collection.
 *
 * Singleton collections have exactly one entry, representing global configuration
 * or settings. This tool updates that single entry without needing to specify an entry ID.
 */
export const updateSingletonTool = {
  name: 'updateSingleton',
  description:
    'Update a singleton collection (a collection with exactly one entry). Use this for global settings or configuration (e.g., "update the site title", "change the footer text", "update SEO settings"). Singleton collections are used for content that exists only once, like site-wide configuration.',
  parameters: type({
    collectionId: id,
    data: 'Record<string, unknown>',
  }),
}

export type UpdateSingletonToolParams = typeof updateSingletonTool.parameters.infer
