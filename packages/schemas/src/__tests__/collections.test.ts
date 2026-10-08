import { describe, expect, it } from 'bun:test'
import {
  collectionConfigSchema,
  relationFieldOptions,
  repeatableBlockOptions,
  supportedCollectionFieldTypes,
} from '../collections'

describe('@edgecms/schemas collections', () => {
  it('accepts Developer Export compatible collection config', () => {
    const result = collectionConfigSchema({
      name: 'Blog Posts',
      slug: 'blog-posts',
      singleton: false,
      defaultLocale: 'en',
      supportedLocales: ['en', 'ms'],
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          localizable: true,
          options: { component: 'input' },
        },
        {
          name: 'author',
          type: 'relation',
          required: false,
          localizable: false,
          options: { targetCollectionId: 'authors', relationType: 'one-to-many' },
        },
        {
          name: 'blocks',
          type: 'array',
          required: false,
          localizable: false,
          options: {
            itemFields: [{ name: 'label', type: 'text', required: true, localizable: false }],
          },
        },
      ],
    })

    expect(result).toMatchObject({
      name: 'Blog Posts',
      slug: 'blog-posts',
      supportedLocales: ['en', 'ms'],
    })
  })

  it('rejects unsupported field types', () => {
    const result = collectionConfigSchema({
      name: 'Bad Collection',
      slug: 'bad-collection',
      singleton: false,
      fields: [
        {
          name: 'unsupported',
          type: 'workflow',
          required: false,
          localizable: false,
        },
      ],
    })

    expect(result.toString()).toContain('type')
  })

  it('documents supported collection field types for public docs and exports', () => {
    expect(supportedCollectionFieldTypes).toEqual([
      'text',
      'richtext',
      'number',
      'boolean',
      'date',
      'media',
      'relation',
      'json',
      'array',
    ])
  })

  it('validates relation and repeatable block option boundaries', () => {
    expect(
      relationFieldOptions({
        targetCollectionId: 'authors',
        relationType: 'one-to-many',
      }),
    ).toMatchObject({
      targetCollectionId: 'authors',
      relationType: 'one-to-many',
    })

    expect(
      repeatableBlockOptions({
        itemFields: [{ name: 'label', type: 'text', required: true, localizable: false }],
        minItems: 0,
        maxItems: 12,
      }),
    ).toMatchObject({
      minItems: 0,
      maxItems: 12,
    })

    expect(
      repeatableBlockOptions({
        itemFields: [],
        maxItems: 0,
      }),
    ).toHaveProperty('issues')
  })
})
