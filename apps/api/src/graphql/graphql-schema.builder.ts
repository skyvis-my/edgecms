import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  type GraphQLFieldConfig,
  type ValueNode,
} from 'graphql'
import { collectionsRepository } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { entriesRepository } from '@/entries/entries.repository'
import { flattenLocaleFields } from '@/shared/locale'
import { API_VERSION } from '@/version'

/**
 * Custom GraphQLJSON scalar supporting arbitrary JSON objects/values.
 */
export const GraphQLJSON: GraphQLScalarType = new GraphQLScalarType({
  name: 'JSON',
  description: 'The `JSON` scalar type represents arbitrary JSON data values.',
  serialize(value: unknown): unknown {
    return value
  },
  parseValue(value: unknown): unknown {
    return value
  },
  parseLiteral(ast: ValueNode, variables?: Record<string, unknown> | null): unknown {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value
      case Kind.INT:
      case Kind.FLOAT:
        return Number(ast.value)
      case Kind.OBJECT: {
        const obj: Record<string, unknown> = {}
        for (const field of ast.fields) {
          obj[field.name.value] = GraphQLJSON.parseLiteral(field.value, variables)
        }
        return obj
      }
      case Kind.LIST:
        return ast.values.map((v) => GraphQLJSON.parseLiteral(v, variables))
      case Kind.NULL:
        return null
      default:
        return null
    }
  },
})

/**
 * Sanitizes a string into a valid GraphQL type name (PascalCase).
 */
export function toGraphQLTypeName(slug: string): string {
  const cleaned = slug.replace(/[^a-zA-Z0-9_]/g, '_')
  const parts = cleaned.split('_').filter(Boolean)
  if (parts.length === 0) return 'ContentItem'
  let result = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  if (/^[0-9]/.test(result)) {
    result = `Col_${result}`
  }
  return result
}

/**
 * Sanitizes a string into a valid GraphQL field name (camelCase).
 */
export function toGraphQLFieldName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_')
  const parts = cleaned.split('_').filter(Boolean)
  if (parts.length === 0) return 'item'
  const first = parts[0]!.charAt(0).toLowerCase() + parts[0]!.slice(1)
  const rest = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  let result = first + rest
  if (/^[0-9]/.test(result)) {
    result = `f_${result}`
  }
  return result
}

function mapFieldTypeToGraphQL(type: string) {
  switch (type) {
    case 'text':
    case 'richtext':
    case 'date':
      return GraphQLString
    case 'number':
      return GraphQLFloat
    case 'boolean':
      return GraphQLBoolean
    case 'media':
    case 'relation':
    case 'json':
    case 'array':
    default:
      return GraphQLJSON
  }
}

const CollectionMetaType = new GraphQLObjectType({
  name: 'CollectionMeta',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    slug: { type: new GraphQLNonNull(GraphQLString) },
    singleton: { type: new GraphQLNonNull(GraphQLBoolean) },
    supportedLocales: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
    defaultLocale: { type: new GraphQLNonNull(GraphQLString) },
  },
})

// In-memory cache for dynamic GraphQL schemas
const schemaCache = new Map<string, { schema: GraphQLSchema; cachedAt: number }>()
const SCHEMA_CACHE_TTL_MS = 60_000

export function clearGraphQLSchemaCache(tenantId?: string): void {
  if (tenantId) {
    schemaCache.delete(tenantId)
  } else {
    schemaCache.clear()
  }
}

/**
 * Dynamically builds a GraphQL schema from collection definitions in D1.
 */
export async function buildDynamicGraphQLSchema(
  db: Database,
  tenantId = 'global'
): Promise<GraphQLSchema> {
  const cached = schemaCache.get(tenantId)
  if (cached && Date.now() - cached.cachedAt < SCHEMA_CACHE_TTL_MS) {
    return cached.schema
  }

  const collections = await collectionsRepository.findAll(db, tenantId)

  const queryFields: Record<string, GraphQLFieldConfig<unknown, unknown>> = {
    _version: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: () => API_VERSION,
    },
    _collections: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(CollectionMetaType))),
      resolve: () => collections,
    },
  }

  for (const col of collections) {
    const typeName = toGraphQLTypeName(col.slug)

    // Build fields map for entry type
    const entryFields: Record<string, GraphQLFieldConfig<unknown, unknown>> = {
      id: { type: new GraphQLNonNull(GraphQLString) },
      slug: { type: GraphQLString },
      status: { type: GraphQLString },
      locale: { type: GraphQLString },
      version: { type: GraphQLInt },
      createdAt: { type: GraphQLString },
      updatedAt: { type: GraphQLString },
      data: { type: GraphQLJSON },
    }

    // Add explicit schema fields
    if (Array.isArray(col.fields)) {
      for (const field of col.fields) {
        const fieldKey = toGraphQLFieldName(field.name)
        if (entryFields[fieldKey]) continue

        entryFields[fieldKey] = {
          type: mapFieldTypeToGraphQL(field.type),
          resolve: (root: unknown) => {
            const r = root as Record<string, unknown> | null | undefined
            if (r?.data && typeof r.data === 'object' && field.name in (r.data as object)) {
              return (r.data as Record<string, unknown>)[field.name]
            }
            return r?.[field.name] ?? null
          },
        }
      }
    }

    const EntryType = new GraphQLObjectType({
      name: typeName,
      fields: () => entryFields,
    })

    function assignUniqueQueryField(
      preferredName: string,
      fieldConfig: GraphQLFieldConfig<unknown, unknown>
    ) {
      let name = preferredName
      let counter = 1
      while (name in queryFields) {
        name = `${preferredName}_${counter++}`
      }
      queryFields[name] = fieldConfig
    }

    if (col.singleton) {
      // Singleton query: siteSettings(locale: String)
      assignUniqueQueryField(toGraphQLFieldName(col.slug), {
        type: EntryType,
        args: {
          locale: { type: GraphQLString },
        },
        resolve: async (_: unknown, args: { locale?: string }) => {
          const { rows } = await entriesRepository.findAll(db, {
            collectionId: col.id,
            status: 'published',
            tenantId,
            perPage: 1,
            skipCount: true,
          })
          const entry = rows[0]
          if (!entry || entry.status !== 'published') return null

          const locale = args.locale || col.defaultLocale || 'en'
          const localizedData = flattenLocaleFields(entry.data, col.fields, locale, col.defaultLocale)

          return {
            ...entry,
            locale,
            data: localizedData,
          }
        },
      })
    } else {
      const baseName = toGraphQLFieldName(col.slug)
      const pluralFieldName = baseName.endsWith('s') ? baseName : `${baseName}s`
      let singularFieldName =
        baseName.endsWith('s') && baseName.length > 1 ? baseName.slice(0, -1) : baseName
      if (singularFieldName === pluralFieldName) {
        singularFieldName = `${baseName}Item`
      }

      // List query: posts(locale: String, page: Int, perPage: Int)
      assignUniqueQueryField(pluralFieldName, {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(EntryType))),
        args: {
          locale: { type: GraphQLString },
          page: { type: GraphQLInt },
          perPage: { type: GraphQLInt },
          sort: { type: GraphQLString },
        },
        resolve: async (
          _: unknown,
          args: { locale?: string; page?: number; perPage?: number; sort?: string }
        ) => {
          const locale = args.locale || col.defaultLocale || 'en'
          const { rows: entries } = await entriesRepository.findAll(db, {
            collectionId: col.id,
            status: 'published',
            tenantId,
            page: args.page || 1,
            perPage: Math.min(args.perPage || 20, 100),
            skipCount: true,
          })

          return entries.map((entry) => ({
            ...entry,
            locale,
            data: flattenLocaleFields(entry.data, col.fields, locale, col.defaultLocale),
          }))
        },
      })

      // Single item query: post(id: String, slug: String, locale: String)
      assignUniqueQueryField(singularFieldName, {
        type: EntryType,
        args: {
          id: { type: GraphQLString },
          slug: { type: GraphQLString },
          locale: { type: GraphQLString },
        },
        resolve: async (_: unknown, args: { id?: string; slug?: string; locale?: string }) => {
          let entry: Awaited<ReturnType<typeof entriesRepository.findById>> = undefined
          if (args.id) {
            entry = await entriesRepository.findById(db, args.id, tenantId)
          } else if (args.slug) {
            entry = await entriesRepository.findByCollectionAndSlug(db, col.id, args.slug, tenantId)
          }

          if (!entry || entry.status !== 'published') return null

          const locale = args.locale || col.defaultLocale || 'en'
          const localizedData = flattenLocaleFields(entry.data, col.fields, locale, col.defaultLocale)

          return {
            ...entry,
            locale,
            data: localizedData,
          }
        },
      })
    }
  }

  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: queryFields,
    }),
  })

  schemaCache.set(tenantId, { schema, cachedAt: Date.now() })
  return schema
}
