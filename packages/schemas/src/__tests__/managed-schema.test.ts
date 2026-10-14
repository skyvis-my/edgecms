import { describe, expect, it } from 'bun:test'
import {
  canonicalizeCollectionSchema,
  computeSchemaHash,
  diffCollectionSchemas,
  managedCollectionManifest,
  validateManagedSchemaMutation,
} from '../managed-schema'
import type { CollectionConfig } from '../collections'

describe('@edgecms/schemas managed-schema', () => {
  const baseCollection: CollectionConfig = {
    name: 'Articles',
    slug: 'articles',
    singleton: false,
    defaultLocale: 'en',
    supportedLocales: ['en', 'fr'],
    fields: [
      { name: 'title', type: 'text', required: true, localizable: true },
      { name: 'content', type: 'richtext', required: false, localizable: true },
      { name: 'viewCount', type: 'number', required: false, localizable: false },
    ],
  }

  it('produces deterministic canonical serialization and hash', () => {
    const shuffledCollection: CollectionConfig = {
      slug: 'articles',
      name: 'Articles',
      singleton: false,
      supportedLocales: ['fr', 'en'], // reverse order
      defaultLocale: 'en',
      fields: [
        { name: 'viewCount', type: 'number', required: false, localizable: false },
        { name: 'content', type: 'richtext', required: false, localizable: true },
        { name: 'title', type: 'text', required: true, localizable: true },
      ],
    }

    const canonical1 = canonicalizeCollectionSchema(baseCollection)
    const canonical2 = canonicalizeCollectionSchema(shuffledCollection)
    expect(canonical1).toBe(canonical2)

    const hash1 = computeSchemaHash(baseCollection)
    const hash2 = computeSchemaHash(shuffledCollection)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)
  })

  it('diff identifies identical schemas', () => {
    const diff = diffCollectionSchemas(baseCollection, baseCollection)
    expect(diff.status).toBe('identical')
    expect(diff.summary.added).toBe(0)
    expect(diff.summary.removed).toBe(0)
    expect(diff.summary.modified).toBe(0)
    expect(diff.summary.unchanged).toBe(3)
  })

  it('diff classifies optional field addition as compatible', () => {
    const target: CollectionConfig = {
      ...baseCollection,
      fields: [
        ...baseCollection.fields,
        { name: 'subtitle', type: 'text', required: false, localizable: true },
      ],
    }

    const diff = diffCollectionSchemas(baseCollection, target)
    expect(diff.status).toBe('compatible')
    expect(diff.summary.added).toBe(1)
    expect(diff.fieldDiffs.find((d) => d.fieldName === 'subtitle')?.severity).toBe('safe')
  })

  it('diff classifies required field addition or field removal as breaking', () => {
    const withRequired: CollectionConfig = {
      ...baseCollection,
      fields: [
        ...baseCollection.fields,
        { name: 'mandatorySlug', type: 'text', required: true, localizable: false },
      ],
    }

    const diff1 = diffCollectionSchemas(baseCollection, withRequired)
    expect(diff1.status).toBe('breaking')
    expect(diff1.fieldDiffs.find((d) => d.fieldName === 'mandatorySlug')?.severity).toBe('breaking')

    const withRemoval: CollectionConfig = {
      ...baseCollection,
      fields: baseCollection.fields.filter((f) => f.name !== 'viewCount'),
    }

    const diff2 = diffCollectionSchemas(baseCollection, withRemoval)
    expect(diff2.status).toBe('breaking')
    expect(diff2.summary.removed).toBe(1)
  })

  it('diff classifies field type mutations as breaking', () => {
    const mutatedType: CollectionConfig = {
      ...baseCollection,
      fields: baseCollection.fields.map((f) =>
        f.name === 'viewCount' ? { ...f, type: 'text' as const } : f
      ),
    }

    const diff = diffCollectionSchemas(baseCollection, mutatedType)
    expect(diff.status).toBe('breaking')
    expect(diff.fieldDiffs.find((d) => d.fieldName === 'viewCount')?.severity).toBe('breaking')
  })

  it('validates managed schema manifest and locks Git-managed collections', () => {
    const manifest = {
      schema: baseCollection,
      schemaHash: computeSchemaHash(baseCollection),
      managedBy: 'git' as const,
      version: 1,
      updatedAt: new Date().toISOString(),
    }

    // Manifest matches schema definition
    expect(managedCollectionManifest(manifest)).toMatchObject({
      managedBy: 'git',
      version: 1,
    })

    const incomingModified: CollectionConfig = {
      ...baseCollection,
      fields: [
        ...baseCollection.fields,
        { name: 'newField', type: 'text', required: false, localizable: false },
      ],
    }

    // Attempting runtime mutation without bypass must fail
    const blocked = validateManagedSchemaMutation(manifest, incomingModified, false)
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toContain('Git-managed')

    // Bypassing or explicit transfer permits modification
    const bypassed = validateManagedSchemaMutation(manifest, incomingModified, true)
    expect(bypassed.allowed).toBe(true)

    // Runtime-managed manifests permit mutations
    const runtimeManifest = { ...manifest, managedBy: 'runtime' as const }
    const allowed = validateManagedSchemaMutation(runtimeManifest, incomingModified, false)
    expect(allowed.allowed).toBe(true)
  })
})
