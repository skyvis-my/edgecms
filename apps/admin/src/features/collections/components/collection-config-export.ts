import type { CollectionDefinition } from '../api/collections-api'
import type { CollectionFormValues } from './collection-form'

type ExportableCollection = Pick<
  CollectionDefinition,
  'name' | 'slug' | 'singleton' | 'fields' | 'defaultLocale' | 'supportedLocales'
>

type CollectionExportInput = CollectionFormValues | ExportableCollection
type CollectionExportPayload = {
  name: string
  slug: string
  singleton: boolean
  defaultLocale?: string
  supportedLocales?: string[]
  fields: CollectionExportInput['fields']
}

type CollectionImportPreview = {
  collectionSlug: string
  additions: number
  changes: number
  removals: number
  destructiveApply: false
}

function normalizeIdentifier(value: string): string {
  const identifier = value
    .trim()
    .replace(/[^a-zA-Z0-9_$]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
    })
    .join('')

  if (!identifier) {
    return 'collectionConfig'
  }

  return /^[a-zA-Z_$]/.test(identifier) ? identifier : `collection${identifier}`
}

function stableJson(value: unknown, indent = 2): string {
  return JSON.stringify(value, (_, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item
    }

    return Object.keys(item)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = (item as Record<string, unknown>)[key]
        return result
      }, {})
  }, indent)
}

export function generateCollectionConfigExport(collection: CollectionExportInput): string {
  const exportName = `${normalizeIdentifier(collection.slug || collection.name)}Collection`
  const withoutUndefined = buildCollectionConfigExportPayload(collection)

  return `export const ${exportName} = ${stableJson(withoutUndefined, 2)} as const\n`
}

export function buildCollectionConfigExportPayload(
  collection: CollectionExportInput
): CollectionExportPayload {
  const payload = {
    name: collection.name,
    slug: collection.slug,
    singleton: collection.singleton,
    defaultLocale: 'defaultLocale' in collection ? collection.defaultLocale : undefined,
    supportedLocales: 'supportedLocales' in collection ? collection.supportedLocales : undefined,
    fields: collection.fields,
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as CollectionExportPayload
}

export function previewCollectionConfigImport(
  current: CollectionExportInput | null,
  incoming: CollectionExportInput
): CollectionImportPreview {
  const currentFields = new Map((current?.fields ?? []).map((field) => [field.name, stableJson(field, 0)]))
  const incomingFields = new Map(incoming.fields.map((field) => [field.name, stableJson(field, 0)]))

  let additions = 0
  let changes = 0
  let removals = 0

  for (const [name, value] of incomingFields) {
    if (!currentFields.has(name)) {
      additions += 1
      continue
    }
    if (currentFields.get(name) !== value) changes += 1
  }

  for (const name of currentFields.keys()) {
    if (!incomingFields.has(name)) removals += 1
  }

  return {
    collectionSlug: incoming.slug,
    additions,
    changes,
    removals,
    destructiveApply: false,
  }
}
