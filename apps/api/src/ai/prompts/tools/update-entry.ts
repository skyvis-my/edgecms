import { Type, createSchema } from '@/shared/schemas/typebox'
import { entryStatus, id } from '@/shared/schemas'

/**
 * AI tool for updating an existing entry.
 *
 * This tool allows the AI to modify entry content, change status, or update the slug.
 * Updates are partial — only the specified fields are changed, others remain unchanged.
 */
export const updateEntryTool = {
  name: 'updateEntry',
  description:
    'Update an existing entry. Use this when the user wants to modify content (e.g., "change the title to X", "update the product price", "mark as draft"). Only the fields provided in data will be updated; other fields remain unchanged. You can also change the status or slug.',
  parameters: createSchema(
    Type.Object({
      entryId: Type.Optional(id),
      id: Type.Optional(id),
      slug: Type.Optional(Type.String()),
      status: Type.Optional(entryStatus),
      data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    })
  ),
}

export type UpdateEntryToolParams = typeof updateEntryTool.parameters.infer
