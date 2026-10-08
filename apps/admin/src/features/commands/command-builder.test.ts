import { describe, expect, it } from 'bun:test'
import {
  buildCreateEntryCommand,
  buildDeleteEntryCommand,
  buildLinkRelationCommand,
  buildPublishNowCommand,
  buildUnlinkRelationCommand,
  buildUnpublishNowCommand,
  buildUpdateEntryCommand,
} from './command-builder'

describe('Command Builder', () => {
  describe('buildCreateEntryCommand', () => {
    it('produces correct envelope with required fields', () => {
      const result = buildCreateEntryCommand('collection-1', { title: 'Test Entry' })

      expect(result.type).toBe('createEntry')
      expect(result.payload).toEqual({
        collectionId: 'collection-1',
        data: { title: 'Test Entry' },
        slug: undefined,
        status: undefined,
      })
      expect(result.actor).toEqual({ source: 'admin' })
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('includes optional slug and status', () => {
      const result = buildCreateEntryCommand(
        'collection-1',
        { title: 'Test' },
        'test-slug',
        'published'
      )

      expect(result.payload.slug).toBe('test-slug')
      expect(result.payload.status).toBe('published')
    })
  })

  describe('buildUpdateEntryCommand', () => {
    it('produces correct envelope', () => {
      const result = buildUpdateEntryCommand('entry-1', { title: 'Updated' })

      expect(result.type).toBe('updateEntry')
      expect(result.payload).toEqual({
        entryId: 'entry-1',
        data: { title: 'Updated' },
        slug: undefined,
        status: undefined,
      })
      expect(result.actor.source).toBe('admin')
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('includes optimistic version when provided', () => {
      const result = buildUpdateEntryCommand(
        'entry-1',
        { title: 'Updated' },
        undefined,
        undefined,
        5
      )

      expect(result.optimisticVersion).toBe(5)
    })

    it('includes slug and status when provided', () => {
      const result = buildUpdateEntryCommand('entry-1', undefined, 'new-slug', 'archived')

      expect(result.payload.slug).toBe('new-slug')
      expect(result.payload.status).toBe('archived')
    })
  })

  describe('buildDeleteEntryCommand', () => {
    it('produces correct envelope', () => {
      const result = buildDeleteEntryCommand('entry-1')

      expect(result.type).toBe('deleteEntry')
      expect(result.payload).toEqual({ entryId: 'entry-1' })
      expect(result.actor).toEqual({ source: 'admin' })
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('buildLinkRelationCommand', () => {
    it('produces correct envelope with all fields', () => {
      const result = buildLinkRelationCommand({
        sourceEntryId: 'entry-1',
        targetEntryId: 'entry-2',
        sourceCollectionId: 'col-1',
        targetCollectionId: 'col-2',
        relationType: 'oneToMany',
        fieldName: 'related_posts',
        sortOrder: 3,
      })

      expect(result.type).toBe('linkRelation')
      expect(result.payload).toEqual({
        sourceEntryId: 'entry-1',
        targetEntryId: 'entry-2',
        sourceCollectionId: 'col-1',
        targetCollectionId: 'col-2',
        relationType: 'oneToMany',
        fieldName: 'related_posts',
        sortOrder: 3,
      })
      expect(result.actor.source).toBe('admin')
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('handles missing optional sortOrder', () => {
      const result = buildLinkRelationCommand({
        sourceEntryId: 'entry-1',
        targetEntryId: 'entry-2',
        sourceCollectionId: 'col-1',
        targetCollectionId: 'col-2',
        relationType: 'manyToMany',
        fieldName: 'tags',
      })

      expect(result.payload.sortOrder).toBeUndefined()
    })
  })

  describe('buildUnlinkRelationCommand', () => {
    it('produces correct envelope', () => {
      const result = buildUnlinkRelationCommand('entry-1', 'entry-2', 'related_posts')

      expect(result.type).toBe('unlinkRelation')
      expect(result.payload).toEqual({
        sourceEntryId: 'entry-1',
        targetEntryId: 'entry-2',
        fieldName: 'related_posts',
      })
      expect(result.actor).toEqual({ source: 'admin' })
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('buildPublishNowCommand', () => {
    it('produces correct envelope', () => {
      const result = buildPublishNowCommand('entry-1')

      expect(result.type).toBe('publishNow')
      expect(result.payload).toEqual({ entryId: 'entry-1' })
      expect(result.actor).toEqual({ source: 'admin' })
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('buildUnpublishNowCommand', () => {
    it('produces correct envelope', () => {
      const result = buildUnpublishNowCommand('entry-1')

      expect(result.type).toBe('unpublishNow')
      expect(result.payload).toEqual({ entryId: 'entry-1' })
      expect(result.actor).toEqual({ source: 'admin' })
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('common envelope properties', () => {
    it('all commands include actor with admin source', () => {
      const commands = [
        buildCreateEntryCommand('col-1', {}),
        buildUpdateEntryCommand('entry-1'),
        buildDeleteEntryCommand('entry-1'),
        buildPublishNowCommand('entry-1'),
        buildUnpublishNowCommand('entry-1'),
        buildLinkRelationCommand({
          sourceEntryId: 'e1',
          targetEntryId: 'e2',
          sourceCollectionId: 'c1',
          targetCollectionId: 'c2',
          relationType: 'oneToMany',
          fieldName: 'field',
        }),
        buildUnlinkRelationCommand('e1', 'e2', 'field'),
      ]

      for (const cmd of commands) {
        expect(cmd.actor.source).toBe('admin')
      }
    })

    it('all commands include a valid ISO timestamp', () => {
      const commands = [
        buildCreateEntryCommand('col-1', {}),
        buildUpdateEntryCommand('entry-1'),
        buildDeleteEntryCommand('entry-1'),
      ]

      for (const cmd of commands) {
        expect(cmd.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      }
    })
  })
})
