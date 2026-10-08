import { describe, expect, it } from 'bun:test'
import { type } from 'arktype'
import { z } from 'zod'

const { arktypeToZod } = await import(`../../../ai/adapters/arktype-to-zod?bypass=${Date.now()}`)

describe('ArkType-to-Zod Adapter', () => {
  describe('basic types', () => {
    it('converts string type', () => {
      const arktype = type('string')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema).toBeInstanceOf(z.ZodString)
      expect(zodSchema.safeParse('hello').success).toBe(true)
      expect(zodSchema.safeParse(123).success).toBe(false)
    })

    it('converts number type', () => {
      const arktype = type('number')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema).toBeInstanceOf(z.ZodNumber)
      expect(zodSchema.safeParse(42).success).toBe(true)
      expect(zodSchema.safeParse('42').success).toBe(false)
    })

    it('converts boolean type', () => {
      const arktype = type('boolean')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema).toBeInstanceOf(z.ZodBoolean)
      expect(zodSchema.safeParse(true).success).toBe(true)
      expect(zodSchema.safeParse('true').success).toBe(false)
    })

    it('converts unknown type', () => {
      const arktype = type('unknown')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema).toBeInstanceOf(z.ZodUnknown)
      expect(zodSchema.safeParse('anything').success).toBe(true)
      expect(zodSchema.safeParse(123).success).toBe(true)
      expect(zodSchema.safeParse({ foo: 'bar' }).success).toBe(true)
    })
  })

  describe('string literal unions', () => {
    it('converts simple string literal union', () => {
      const arktype = type("'draft' | 'published'")
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema).toBeInstanceOf(z.ZodEnum)
      expect(zodSchema.safeParse('draft').success).toBe(true)
      expect(zodSchema.safeParse('published').success).toBe(true)
      expect(zodSchema.safeParse('invalid').success).toBe(false)
    })

    it('converts multi-value string literal union', () => {
      const arktype = type("'draft' | 'scheduled' | 'published' | 'archived'")
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse('draft').success).toBe(true)
      expect(zodSchema.safeParse('scheduled').success).toBe(true)
      expect(zodSchema.safeParse('published').success).toBe(true)
      expect(zodSchema.safeParse('archived').success).toBe(true)
      expect(zodSchema.safeParse('invalid').success).toBe(false)
    })

    it('converts relation type union', () => {
      const arktype = type("'one-to-one' | 'one-to-many' | 'many-to-many'")
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse('one-to-one').success).toBe(true)
      expect(zodSchema.safeParse('one-to-many').success).toBe(true)
      expect(zodSchema.safeParse('many-to-many').success).toBe(true)
    })
  })

  describe('constrained numbers', () => {
    it('converts integer constraint', () => {
      const arktype = type('number.integer')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse(42).success).toBe(true)
      expect(zodSchema.safeParse(42.5).success).toBe(false)
    })

    it('converts integer with minimum constraint', () => {
      const arktype = type('number.integer >= 0')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse(0).success).toBe(true)
      expect(zodSchema.safeParse(10).success).toBe(true)
      expect(zodSchema.safeParse(-1).success).toBe(false)
      expect(zodSchema.safeParse(0.5).success).toBe(false)
    })

    it('converts integer with minimum constraint (version >= 1)', () => {
      const arktype = type('number.integer >= 1')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse(1).success).toBe(true)
      expect(zodSchema.safeParse(10).success).toBe(true)
      expect(zodSchema.safeParse(0).success).toBe(false)
    })

    it('converts integer with range constraint', () => {
      const arktype = type('1 <= number.integer <= 100')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse(1).success).toBe(true)
      expect(zodSchema.safeParse(50).success).toBe(true)
      expect(zodSchema.safeParse(100).success).toBe(true)
      expect(zodSchema.safeParse(0).success).toBe(false)
      expect(zodSchema.safeParse(101).success).toBe(false)
    })
  })

  describe('array types', () => {
    it('converts string array', () => {
      const arktype = type('string[]')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema).toBeInstanceOf(z.ZodArray)
      expect(zodSchema.safeParse(['a', 'b', 'c']).success).toBe(true)
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(false)
    })

    it('converts number array', () => {
      const arktype = type('number[]')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true)
      expect(zodSchema.safeParse(['a', 'b']).success).toBe(false)
    })

    it('converts array with .array() method', () => {
      const baseType = type('string')
      const arktype = baseType.array()
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse(['a', 'b', 'c']).success).toBe(true)
    })
  })

  describe('record types', () => {
    it('converts Record<string, unknown>', () => {
      const arktype = type('Record<string, unknown>')
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema).toBeInstanceOf(z.ZodRecord)
      expect(zodSchema.safeParse({ foo: 'bar', baz: 123 }).success).toBe(true)
      expect(zodSchema.safeParse('not an object').success).toBe(false)
    })
  })

  describe('object types', () => {
    it('converts simple object with required fields', () => {
      const arktype = type({
        name: 'string',
        age: 'number',
      })
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema).toBeInstanceOf(z.ZodObject)
      expect(zodSchema.safeParse({ name: 'John', age: 30 }).success).toBe(true)
      expect(zodSchema.safeParse({ name: 'John' }).success).toBe(false)
    })

    it('converts object with optional fields', () => {
      const arktype = type({
        name: 'string',
        'age?': 'number',
      })
      const zodSchema = arktypeToZod(arktype)
      expect(zodSchema.safeParse({ name: 'John', age: 30 }).success).toBe(true)
      expect(zodSchema.safeParse({ name: 'John' }).success).toBe(true)
      expect(zodSchema.safeParse({ age: 30 }).success).toBe(false)
    })

    it('converts nested object types', () => {
      const arktype = type({
        user: type({
          id: 'string',
          name: 'string',
        }),
        'metadata?': 'Record<string, unknown>',
      })
      const zodSchema = arktypeToZod(arktype)
      expect(
        zodSchema.safeParse({
          user: { id: '123', name: 'John' },
          metadata: { foo: 'bar' },
        }).success
      ).toBe(true)
      expect(zodSchema.safeParse({ user: { id: '123', name: 'John' } }).success).toBe(true)
    })
  })

  describe('complex EdgeCMS schemas', () => {
    it('converts createEntryPayload schema', () => {
      const id = type(/^[a-z][a-z0-9]{23,}$/)
      const entryStatus = type("'draft' | 'scheduled' | 'published' | 'archived'")

      const arktype = type({
        collectionId: id,
        'slug?': 'string',
        'status?': entryStatus,
        data: 'Record<string, unknown>',
      })

      const zodSchema = arktypeToZod(arktype)
      expect(
        zodSchema.safeParse({
          collectionId: 'abc123def456ghi789jkl012',
          slug: 'my-post',
          status: 'draft',
          data: { title: 'Hello World' },
        }).success
      ).toBe(true)
    })

    it('converts updateEntryPayload schema', () => {
      const id = type(/^[a-z][a-z0-9]{23,}$/)
      const entryStatus = type("'draft' | 'scheduled' | 'published' | 'archived'")

      const arktype = type({
        entryId: id,
        'slug?': 'string',
        'status?': entryStatus,
        'data?': 'Record<string, unknown>',
      })

      const zodSchema = arktypeToZod(arktype)
      expect(
        zodSchema.safeParse({
          entryId: 'abc123def456ghi789jkl012',
          slug: 'updated-slug',
        }).success
      ).toBe(true)
    })

    it('converts linkRelationPayload schema', () => {
      const id = type(/^[a-z][a-z0-9]{23,}$/)
      const relationType = type("'one-to-one' | 'one-to-many' | 'many-to-many'")

      const arktype = type({
        sourceEntryId: id,
        targetEntryId: id,
        sourceCollectionId: id,
        targetCollectionId: id,
        relationType,
        fieldName: 'string',
        'sortOrder?': 'number.integer >= 0',
      })

      const zodSchema = arktypeToZod(arktype)
      expect(
        zodSchema.safeParse({
          sourceEntryId: 'abc123def456ghi789jkl012',
          targetEntryId: 'xyz789abc123def456ghi012',
          sourceCollectionId: 'col123abc456def789ghi012',
          targetCollectionId: 'col456def789ghi012abc123',
          relationType: 'one-to-many',
          fieldName: 'author',
          sortOrder: 0,
        }).success
      ).toBe(true)
    })

    it('converts commandEnvelope schema', () => {
      const id = type(/^[a-z][a-z0-9]{23,}$/)
      const commandType = type(
        "'createEntry' | 'updateEntry' | 'deleteEntry' | 'bulkUpdate' | 'updateSingleton' | 'linkRelation' | 'unlinkRelation' | 'publishNow' | 'unpublishNow' | 'transaction'"
      )
      const timestamp = type(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)

      const arktype = type({
        type: commandType,
        payload: 'Record<string, unknown>',
        actor: type({
          userId: id,
          source: "'admin' | 'ai' | 'sync'",
        }),
        'optimisticVersion?': 'number.integer >= 1',
        'transactionId?': id,
        'dryRun?': 'boolean',
        timestamp,
      })

      const zodSchema = arktypeToZod(arktype)
      expect(
        zodSchema.safeParse({
          type: 'createEntry',
          payload: { collectionId: 'col123', data: {} },
          actor: {
            userId: 'usr123abc456def789ghi012',
            source: 'admin',
          },
          timestamp: '2026-02-07T10:30:00.000Z',
        }).success
      ).toBe(true)
    })
  })
})
