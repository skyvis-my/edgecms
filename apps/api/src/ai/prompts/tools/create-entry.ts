import { Type, createSchema } from '@/shared/schemas/typebox'
import { entryStatus, id } from '@/shared/schemas'

/**
 * AI tool for creating a new entry.
 *
 * This tool allows the AI to create entries in collections based on user requests.
 * The AI should infer the appropriate collection, generate a slug if not provided,
 * and structure the data according to the collection's field definitions.
 */
export const createEntryTool = {
  name: 'createEntry',
  description:
    'Create a new entry in a collection. Use this when the user wants to add new content (e.g., "create a blog post about X", "add a new product"). The AI should infer the correct collection based on context, generate a URL-friendly slug, and structure field data according to the collection schema.',
  parameters: createSchema(
    Type.Object({
      collectionId: id,
      slug: Type.Optional(Type.String()),
      status: Type.Optional(entryStatus),
      data: Type.Record(Type.String(), Type.Unknown()),
    })
  ),
}

export type CreateEntryToolParams = typeof createEntryTool.parameters.infer
