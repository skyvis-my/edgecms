import { describe, expect, it } from 'bun:test'
import { collectionConfigSchema } from '../../../../../../packages/schemas/src/collections'
import {
  buildCollectionConfigExportPayload,
  generateCollectionConfigExport,
  previewCollectionConfigImport,
} from './collection-config-export'

describe('generateCollectionConfigExport', () => {
  it('generates deterministic TypeScript config text from collection form values', () => {
    const output = generateCollectionConfigExport({
      name: 'Blog Posts',
      slug: 'blog-posts',
      singleton: false,
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
          localizable: true,
          options: { width: 'full', component: 'input' },
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
            itemFields: [{ name: 'label', type: 'text', required: true }],
          },
        },
      ],
    })

    expect(output).toContain('export const blogPostsCollection = {')
    expect(output).toContain('"slug": "blog-posts"')
    expect(output).toContain('"relationType": "one-to-many"')
    expect(output).toContain('"itemFields"')
    expect(output).toEndWith(' as const\n')
  })

  it('creates a valid identifier when slug starts with a number', () => {
    const output = generateCollectionConfigExport({
      name: '2026 Landing Pages',
      slug: '2026-landing-pages',
      singleton: false,
      fields: [],
    })

    expect(output).toStartWith('export const collection2026LandingPagesCollection = ')
  })

  it('validates exported collection config through shared schema', () => {
    const payload = buildCollectionConfigExportPayload({
      name: 'Blog Posts',
      slug: 'blog-posts',
      singleton: false,
      defaultLocale: 'en',
      supportedLocales: ['en', 'ms'],
      fields: [
        { name: 'title', type: 'text', required: true, localizable: true },
        {
          name: 'author',
          type: 'relation',
          required: false,
          localizable: false,
          options: { targetCollectionId: 'authors', relationType: 'one-to-many' },
        },
      ],
    })

    expect(collectionConfigSchema(payload)).toMatchObject({
      name: 'Blog Posts',
      slug: 'blog-posts',
    })
  })

  it('previews collection config import without destructive apply', () => {
    const preview = previewCollectionConfigImport(
      {
        name: 'Blog Posts',
        slug: 'blog-posts',
        singleton: false,
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      },
      {
        name: 'Blog Posts',
        slug: 'blog-posts',
        singleton: false,
        fields: [
          { name: 'title', type: 'text', required: false, localizable: false },
          { name: 'summary', type: 'richtext', required: false, localizable: false },
        ],
      }
    )

    expect(preview).toEqual({
      collectionSlug: 'blog-posts',
      additions: 1,
      changes: 1,
      removals: 0,
      destructiveApply: false,
    })
  })
})
