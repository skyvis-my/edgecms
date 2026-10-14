import { Type, createSchema } from '@/shared/schemas/typebox'
import { id, relationType } from '@/shared/schemas'

/**
 * AI tool for linking two entries via a relation.
 *
 * This tool allows the AI to create relationships between entries,
 * such as linking an author to a blog post, or products to a category.
 */
export const linkRelationTool = {
  name: 'linkRelation',
  description:
    'Create a relationship between two entries. Use this when the user wants to link content (e.g., "link this post to the author John", "add this product to the Electronics category", "associate this image with the article"). The sourceEntry is the entry that owns the relation (e.g., the blog post), and targetEntry is what it references (e.g., the author).',
  parameters: createSchema(
    Type.Object({
      sourceEntryId: id,
      targetEntryId: id,
      sourceCollectionId: id,
      targetCollectionId: id,
      relationType,
      fieldName: Type.String(),
      sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
    })
  ),
}

export type LinkRelationToolParams = typeof linkRelationTool.parameters.infer
