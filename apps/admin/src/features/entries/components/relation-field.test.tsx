import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FieldDefinition } from '@/features/collections/api/collections-api'

const mockLinkMutateAsync = vi.fn().mockResolvedValue({})
const mockUnlinkMutateAsync = vi.fn().mockResolvedValue({})
const mockExistingRelations: Array<{ id: string; targetEntryId: string; fieldName: string }> = []

vi.mock('../api/relations-api', () => ({
  useEntryRelations: () => ({ data: mockExistingRelations }),
  useLinkRelation: () => ({ mutateAsync: mockLinkMutateAsync }),
  useUnlinkRelation: () => ({ mutateAsync: mockUnlinkMutateAsync }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('./relation-picker', () => ({
  RelationPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <div data-testid='relation-picker'>
      <button type='button' onClick={() => onSelect('target-entry-1')}>
        Select Target 1
      </button>
      <button type='button' onClick={() => onSelect('target-entry-2')}>
        Select Target 2
      </button>
    </div>
  ),
}))

vi.mock('./related-entries-display', () => ({
  RelatedEntriesDisplay: ({
    relations,
    onUnlink,
    onReorder,
  }: {
    relations: Array<{ id: string; targetEntryId: string }>
    onUnlink: (id: string) => void
    onReorder?: (ids: string[]) => void
  }) => (
    <div data-testid='related-entries-display'>
      {relations.map((r) => (
        <div key={r.id}>
          <span>{r.targetEntryId}</span>
          <button type='button' onClick={() => onUnlink(r.targetEntryId)}>
            Unlink {r.targetEntryId}
          </button>
        </div>
      ))}
      {onReorder ? (
        <button type='button' onClick={() => onReorder(['target-entry-2', 'target-entry-1'])}>
          Reorder All
        </button>
      ) : null}
    </div>
  ),
}))

import { RelationField } from './relation-field'

describe('RelationField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistingRelations.length = 0
  })

  it('renders alert when targetCollectionId is missing', () => {
    const field: FieldDefinition = {
      id: 'f1',
      name: 'author',
      label: 'Author',
      type: 'relation',
      required: false,
    }

    render(
      <RelationField
        field={field}
        sourceCollectionId='posts'
        value=''
        onChange={() => {}}
      />
    )

    expect(
      screen.getByText('Relation field "author" is missing targetCollectionId in options.')
    ).toBeDefined()
  })

  it('handles selecting and unlinking entries for a new entry', () => {
    const onChange = vi.fn()
    const field: FieldDefinition = {
      id: 'f1',
      name: 'categories',
      label: 'Categories',
      type: 'relation',
      required: false,
      options: {
        targetCollectionId: 'cats',
        relationType: 'many-to-many',
      },
    }

    const { rerender } = render(
      <RelationField
        field={field}
        sourceCollectionId='posts'
        value={[]}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByText('Select Target 1'))
    expect(onChange).toHaveBeenCalledWith(['target-entry-1'])

    // Re-render with value set
    rerender(
      <RelationField
        field={field}
        sourceCollectionId='posts'
        value={['target-entry-1']}
        onChange={onChange}
      />
    )

    expect(screen.getByText('target-entry-1')).toBeDefined()
    expect(screen.getByText('Relations will be created after saving the entry.')).toBeDefined()

    // Selecting duplicate triggers info toast
    fireEvent.click(screen.getByText('Select Target 1'))

    // Unlink entry
    fireEvent.click(screen.getByText('Remove'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('links and unlinks relations on existing entry for one-to-one', async () => {
    const onChange = vi.fn()
    mockExistingRelations.push({ id: 'r1', targetEntryId: 'target-entry-old', fieldName: 'author' })

    const field: FieldDefinition = {
      id: 'f1',
      name: 'author',
      label: 'Author',
      type: 'relation',
      required: false,
      options: {
        targetCollectionId: 'users',
        relationType: 'one-to-one',
      },
    }

    render(
      <RelationField
        field={field}
        entryId='post-1'
        sourceCollectionId='posts'
        value='target-entry-old'
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByText('Select Target 1'))

    expect(onChange).toHaveBeenCalledWith('target-entry-1')
    await waitFor(() => {
      expect(mockUnlinkMutateAsync).toHaveBeenCalledWith({
        sourceEntryId: 'post-1',
        targetEntryId: 'target-entry-old',
        fieldName: 'author',
      })
      expect(mockLinkMutateAsync).toHaveBeenCalledWith({
        sourceEntryId: 'post-1',
        targetEntryId: 'target-entry-1',
        sourceCollectionId: 'posts',
        targetCollectionId: 'users',
        relationType: 'one-to-one',
        fieldName: 'author',
        sortOrder: 0,
      })
    })
  })

  it('supports reordering relations for existing entries', async () => {
    const onChange = vi.fn()
    mockExistingRelations.push(
      { id: 'r1', targetEntryId: 'target-entry-1', fieldName: 'tags' },
      { id: 'r2', targetEntryId: 'target-entry-2', fieldName: 'tags' }
    )

    const field: FieldDefinition = {
      id: 'f1',
      name: 'tags',
      label: 'Tags',
      type: 'relation',
      required: false,
      options: {
        targetCollectionId: 'tag_collection',
        relationType: 'one-to-many',
      },
    }

    render(
      <RelationField
        field={field}
        entryId='post-1'
        sourceCollectionId='posts'
        value={['target-entry-1', 'target-entry-2']}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByText('Reorder All'))

    expect(onChange).toHaveBeenCalledWith(['target-entry-2', 'target-entry-1'])
    await waitFor(() => {
      expect(mockUnlinkMutateAsync).toHaveBeenCalledTimes(2)
      expect(mockLinkMutateAsync).toHaveBeenCalledTimes(2)
    })
  })
})
