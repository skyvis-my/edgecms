import type { Type } from 'arktype'
import { z } from 'zod'

/**
 * ArkType-to-Zod Adapter
 *
 * Converts ArkType schemas to Zod schemas for use with Vercel AI SDK.
 * The AI SDK requires Zod schemas for tool parameter definitions.
 *
 * This adapter handles the specific ArkType patterns used in EdgeCMS:
 * - String literals and unions
 * - Numeric constraints
 * - Object types with optional fields
 * - Arrays
 * - Records
 * - Regex patterns
 *
 * NOTE: This is not a general-purpose converter. It handles the specific
 * ArkType patterns found in apps/api/src/shared/schemas/.
 */

/**
 * Convert an ArkType schema to an equivalent Zod schema.
 *
 * @param arktypeSchema - ArkType type definition
 * @returns Equivalent Zod schema
 * @throws Error if the ArkType pattern is not supported
 */
export function arktypeToZod(arktypeSchema: Type): z.ZodTypeAny {
  const description = arktypeSchema.description

  // Get the JSON representation of the ArkType schema
  // ArkType v2 exposes its structure through the .json property
  const json = arktypeSchema.json

  return parseArktypeJson(json, description)
}

/**
 * Parse ArkType JSON representation into Zod schema.
 */
// oxlint-disable-next-line lint/suspicious/noExplicitAny: ArkType's JSON representation is inherently dynamic
function parseArktypeJson(json: any, description?: string): z.ZodTypeAny {
  if (!json) {
    return description ? z.unknown().describe(description) : z.unknown()
  }

  // Handle arrays (union of multiple branches)
  if (Array.isArray(json)) {
    // Check if it's a boolean (union of false and true)
    if (
      json.length === 2 &&
      json.some((item) => item.unit === false) &&
      json.some((item) => item.unit === true)
    ) {
      const zodSchema = z.boolean()
      return description ? zodSchema.describe(description) : zodSchema
    }

    // Check if it's a union of string literals
    if (json.every((item) => item.unit !== undefined && typeof item.unit === 'string')) {
      const literals = json.map((item) => item.unit)
      const zodSchema = z.enum(literals as [string, ...string[]])
      return description ? zodSchema.describe(description) : zodSchema
    }

    // Otherwise, treat as a generic union
    const schemas = json.map((item) => parseArktypeJson(item, undefined))
    const zodSchema = z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
    return description ? zodSchema.describe(description) : zodSchema
  }

  // Handle proto (for arrays and sequences)
  if (json.proto === 'Array') {
    // json.sequence can be a string (domain type) or an object
    const elementSchema =
      typeof json.sequence === 'string'
        ? parseArktypeJson({ domain: json.sequence }, undefined)
        : parseArktypeJson(json.sequence, undefined)
    const zodSchema = z.array(elementSchema)
    return description ? zodSchema.describe(description) : zodSchema
  }

  // Handle primitive types based on domain
  if (json.domain) {
    switch (json.domain) {
      case 'string': {
        let zodSchema: z.ZodString = z.string()

        // Handle regex patterns
        if (json.pattern && Array.isArray(json.pattern) && json.pattern.length > 0) {
          zodSchema = zodSchema.regex(new RegExp(json.pattern[0]))
        }

        return description ? zodSchema.describe(description) : zodSchema
      }
      case 'number': {
        let zodSchema: z.ZodNumber = z.number()

        // Handle integer constraint (divisor: 1)
        if (json.divisor === 1) {
          zodSchema = zodSchema.int()
        }

        // Handle min/max constraints
        if (json.min !== undefined) {
          zodSchema = json.minExclusive ? zodSchema.gt(json.min) : zodSchema.gte(json.min)
        }
        if (json.max !== undefined) {
          zodSchema = json.maxExclusive ? zodSchema.lt(json.max) : zodSchema.lte(json.max)
        }

        return description ? zodSchema.describe(description) : zodSchema
      }
      case 'boolean':
        return description ? z.boolean().describe(description) : z.boolean()
      case 'object': {
        // Handle index signatures (Record types)
        if (json.index && Array.isArray(json.index) && json.index.length > 0) {
          // json.index[0].value is the value type
          const valueSchema =
            Object.keys(json.index[0].value).length === 0
              ? z.unknown()
              : parseArktypeJson(json.index[0].value, undefined)
          const zodSchema = z.record(z.string(), valueSchema)
          return description ? zodSchema.describe(description) : zodSchema
        }

        const shape: Record<string, z.ZodTypeAny> = {}

        // Handle required fields
        if (json.required) {
          for (const field of json.required) {
            const fieldSchema =
              typeof field.value === 'string'
                ? parseArktypeJson({ domain: field.value }, undefined)
                : parseArktypeJson(field.value, undefined)
            shape[field.key] = fieldSchema
          }
        }

        // Handle optional fields
        if (json.optional) {
          for (const field of json.optional) {
            const fieldSchema =
              typeof field.value === 'string'
                ? parseArktypeJson({ domain: field.value }, undefined)
                : parseArktypeJson(field.value, undefined)
            shape[field.key] = fieldSchema.optional()
          }
        }

        const zodSchema = z.object(shape)
        return description ? zodSchema.describe(description) : zodSchema
      }
      default:
        // Handle unknown or any other domain
        return description ? z.unknown().describe(description) : z.unknown()
    }
  }

  // Handle unit (single literal value)
  if (json.unit !== undefined) {
    const zodSchema = z.literal(json.unit)
    return description ? zodSchema.describe(description) : zodSchema
  }

  // Empty object means unknown
  if (Object.keys(json).length === 0) {
    return description ? z.unknown().describe(description) : z.unknown()
  }

  // Fallback for unknown patterns
  throw new Error(`Unsupported ArkType JSON structure: ${JSON.stringify(json)}`)
}

/**
 * Convenience function to convert ArkType schema and get the inferred type.
 *
 * @param arktypeSchema - ArkType type definition
 * @returns Tuple of [Zod schema, inferred type]
 */
export function arktypeToZodWithType<T extends Type>(
  arktypeSchema: T
): [z.ZodTypeAny, z.infer<ReturnType<typeof arktypeToZod>>] {
  const zodSchema = arktypeToZod(arktypeSchema)
  // oxlint-disable-next-line lint/suspicious/noExplicitAny: Type inference placeholder
  return [zodSchema, undefined as any]
}
