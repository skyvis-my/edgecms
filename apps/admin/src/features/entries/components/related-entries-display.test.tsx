import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Entry } from '../api/entries-api'
import type { Relation } from '../api/relations-api'

const mockEntries: Entry[] = []
const mockCollections: Array<{ id: string; name: string }> = []

vi.mock('../api/entries-api', () => ({
  useEntriesByIds: () => ({ data: mockEntries }),
}))

vi.mock('@/features/collections/api/collections-api', () => ({
  useCollections: () => ({ data: mockCollections }),
}))

import { RelatedEntriesDisplay } from './related-entries-display'

describe('RelatedEntriesDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEntries.length = 0
    mockCollections.length = 0
  })

  it('renders empty placeholder when relations list is empty', () => {
    render(<RelatedEntriesDisplay relations={[]} onUnlink={() => {}} />)
    expect(screen.getByText('No related entries')).toBeDefined()
  })

  it('renders entries with displayText, collection badges, and unlinks entry', () => {
    const onUnlink = vi.fn()
    mockCollections.push({ id: 'c1', name: 'Articles' })
    mockEntries.push({
      id: 'e1',
      slug: 'my-post',
      tenantId: 'tenant-1',
      collectionId: 'c1',
      status: 'published',
      data: {
        title: 'This is a very long title that exceeds forty characters easily for testing truncation',
      },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })

    const relations: Relation[] = [
      {
        id: 'r1',
        sourceEntryId: 'parent-1',
        targetEntryId: 'e1',
        sourceCollectionId: 'cats',
        targetCollectionId: 'c1',
        relationType: 'one-to-many',
        fieldName: 'posts',
        sortOrder: 0,
        createdAt: '2026-01-01',
      },
    ]

    render(<RelatedEntriesDisplay relations={relations} onUnlink={onUnlink} />)

    expect(
      screen.getByText('This is a very long title that exceeds f...')
    ).toBeDefined()
    expect(screen.getByText('Articles')).toBeDefined()

    fireEvent.click(screen.getByTitle('Remove relation'))
    expect(onUnlink).toHaveBeenCalledWith('e1')
  })

  it('falls back to slug or targetEntryId when entry or text field is missing', () => {
    mockEntries.push({
      id: 'e2',
      slug: 'entry-slug-fallback',
      tenantId: 'tenant-1',
      collectionId: 'c2',
      status: 'draft',
      data: { count: 123 }, // no string values
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })

    const relations: Relation[] = [
      {
        id: 'r1',
        sourceEntryId: 'parent-1',
        targetEntryId: 'e2',
        sourceCollectionId: 'cats',
        targetCollectionId: 'c2',
        relationType: 'one-to-many',
        fieldName: 'posts',
        sortOrder: 0,
        createdAt: '2026-01-01',
      },
      {
        id: 'r2',
        sourceEntryId: 'parent-1',
        targetEntryId: 'missing-entry-id',
        sourceCollectionId: 'cats',
        targetCollectionId: 'c2',
        relationType: 'one-to-many',
        fieldName: 'posts',
        sortOrder: 1,
        createdAt: '2026-01-01',
      },
    ]

    render(<RelatedEntriesDisplay relations={relations} onUnlink={() => {}} />)

    expect(screen.getByText('entry-slug-fallback')).toBeDefined()
    expect(screen.getByText('missing-entry-id')).toBeDefined()
  })

  it('reorders entries up and down and respects boundary button disables', () => {
    const onReorder = vi.fn()
    const relations: Relation[] = [
      {
        id: 'r1',
        sourceEntryId: 'p1',
        targetEntryId: 'e1',
        sourceCollectionId: 'c1',
        targetCollectionId: 'c1',
        relationType: 'one-to-many',
        fieldName: 'items',
        sortOrder: 0,
        createdAt: '2026-01-01',
      },
      {
        id: 'r2',
        sourceEntryId: 'p1',
        targetEntryId: 'e2',
        sourceCollectionId: 'c1',
        targetCollectionId: 'c1',
        relationType: 'one-to-many',
        fieldName: 'items',
        sortOrder: 1,
        createdAt: '2026-01-01',
      },
    ]

    render(
      <RelatedEntriesDisplay
        relations={relations}
        onUnlink={() => {}}
        onReorder={onReorder}
      />
    )

    const moveUpButtons = screen.getAllByTitle('Move up')
    const moveDownButtons = screen.getAllByTitle('Move down')

    expect(moveUpButtons[0]!.getAttribute('disabled')).toBeDefined()
    expect(moveDownButtons[1]!.getAttribute('disabled')).toBeDefined()

    // Move first item down
    fireEvent.click(moveDownButtons[0]!)
    expect(onReorder).toHaveBeenCalledWith(['e2', 'e1'])

    // Move second item up
    fireEvent.click(moveUpButtons[1]!)
    expect(onReorder).toHaveBeenCalledWith(['e2', 'e1'])
  })
})
