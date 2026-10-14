import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Entry } from '../api/entries-api'

const mockEntries: Entry[] = []
let mockLoading = false
const mockCollection = { id: 'col-1', name: 'Articles', slug: 'articles' }

vi.mock('@/features/collections/api/collections-api', () => ({
  useCollection: () => ({ data: mockCollection }),
}))

vi.mock('../api/entries-api', () => ({
  useEntries: () => ({
    data: { data: mockEntries },
    isLoading: mockLoading,
  }),
}))

import { RelationPicker } from './relation-picker'

describe('RelationPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEntries.length = 0
    mockLoading = false
  })

  it('renders one-to-one button with default placeholder when nothing selected', () => {
    render(
      <RelationPicker
        targetCollectionId='col-1'
        relationType='one-to-one'
        selectedEntryIds={[]}
        onSelect={() => {}}
      />
    )

    expect(screen.getByRole('combobox')).toBeDefined()
    expect(screen.getByText('Select entry...')).toBeDefined()
  })

  it('renders one-to-many button with collection name placeholder', () => {
    render(
      <RelationPicker
        targetCollectionId='col-1'
        relationType='one-to-many'
        selectedEntryIds={[]}
        onSelect={() => {}}
      />
    )

    expect(screen.getByText('Select from Articles...')).toBeDefined()
  })

  it('displays selected entry title and truncates long text', () => {
    mockEntries.push({
      id: 'e1',
      slug: 'my-long-post',
      tenantId: 'tenant-1',
      collectionId: 'col-1',
      status: 'published',
      data: {
        title: 'This is an exceptionally long title designed to exceed the fifty characters truncation limit',
      },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })

    render(
      <RelationPicker
        targetCollectionId='col-1'
        relationType='one-to-one'
        selectedEntryIds={['e1']}
        onSelect={() => {}}
      />
    )

    expect(
      screen.getByText(
        'This is an exceptionally long title designed to ex...'
      )
    ).toBeDefined()
  })

  it('falls back to slug when entry has no string data fields', () => {
    mockEntries.push({
      id: 'e2',
      slug: 'slug-only-entry',
      tenantId: 'tenant-1',
      collectionId: 'col-1',
      status: 'draft',
      data: { count: 42 },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })

    render(
      <RelationPicker
        targetCollectionId='col-1'
        relationType='one-to-one'
        selectedEntryIds={['e2']}
        onSelect={() => {}}
      />
    )

    expect(screen.getByText('slug-only-entry')).toBeDefined()
  })

  it('opens popover, lists entries, shows badges and selects item in one-to-one mode', () => {
    const onSelect = vi.fn()
    mockEntries.push(
      {
        id: 'e1',
        slug: 'post-one',
        tenantId: 'tenant-1',
        collectionId: 'col-1',
        status: 'published',
        data: { title: 'First Post' },
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'e2',
        slug: 'post-two',
        tenantId: 'tenant-1',
        collectionId: 'col-1',
        status: 'draft',
        data: { title: 'Second Post' },
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }
    )

    render(
      <RelationPicker
        targetCollectionId='col-1'
        relationType='one-to-one'
        selectedEntryIds={['e1']}
        onSelect={onSelect}
      />
    )

    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)

    expect(screen.getByPlaceholderText('Search entries...')).toBeDefined()
    expect(screen.getAllByText('First Post').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Second Post')).toBeDefined()
    expect(screen.getByText('published')).toBeDefined()
    expect(screen.getByText('draft')).toBeDefined()

    // Click item 2
    fireEvent.click(screen.getByText('Second Post'))
    expect(onSelect).toHaveBeenCalledWith('e2')
  })

  it('filters entries by search query across slug and string values', () => {
    mockEntries.push(
      {
        id: 'e1',
        slug: 'alpha-post',
        tenantId: 'tenant-1',
        collectionId: 'col-1',
        status: 'published',
        data: { title: 'Red Apple' },
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'e2',
        slug: 'beta-post',
        tenantId: 'tenant-1',
        collectionId: 'col-1',
        status: 'published',
        data: { title: 'Green Pear' },
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }
    )

    render(
      <RelationPicker
        targetCollectionId='col-1'
        relationType='one-to-many'
        selectedEntryIds={[]}
        onSelect={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search entries...')
    // Search by data string
    fireEvent.change(searchInput, { target: { value: 'Apple' } })
    expect(screen.getByText('Red Apple')).toBeDefined()
    expect(screen.queryByText('Green Pear')).toBeNull()

    // Search by slug
    fireEvent.change(searchInput, { target: { value: 'beta' } })
    expect(screen.getByText('Green Pear')).toBeDefined()
    expect(screen.queryByText('Red Apple')).toBeNull()
  })

  it('shows loading and empty states', () => {
    mockLoading = true
    const { rerender } = render(
      <RelationPicker
        targetCollectionId='col-1'
        relationType='one-to-one'
        selectedEntryIds={[]}
        onSelect={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByText('Loading entries...')).toBeDefined()

    mockLoading = false
    rerender(
      <RelationPicker
        targetCollectionId='col-1'
        relationType='one-to-one'
        selectedEntryIds={[]}
        onSelect={() => {}}
      />
    )
    expect(screen.getByText('No entries found.')).toBeDefined()
  })
})
