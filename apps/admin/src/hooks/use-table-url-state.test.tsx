import { beforeEach, describe, expect, it } from 'bun:test'
import { renderHook, act } from '@testing-library/react'
import type { NavigateFn } from './use-table-url-state'
import { useTableUrlState } from './use-table-url-state'

describe('useTableUrlState', () => {
  let navigateCalls: Array<{ search: unknown; replace?: boolean }>

  function createNavigate(): NavigateFn {
    navigateCalls = []
    return (opts) => {
      navigateCalls.push(opts)
    }
  }

  beforeEach(() => {
    navigateCalls = []
  })

  describe('pagination', () => {
    it('returns default pagination when no URL params are present', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 10 })
    })

    it('reads page from URL search params (1-indexed to 0-indexed)', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: { page: 3 }, navigate }))

      expect(result.current.pagination.pageIndex).toBe(2) // page 3 = index 2
    })

    it('reads pageSize from URL search params', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: { pageSize: 25 }, navigate }))

      expect(result.current.pagination.pageSize).toBe(25)
    })

    it('uses custom page and pageSize keys', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { p: 5, ps: 50 },
          navigate,
          pagination: { pageKey: 'p', pageSizeKey: 'ps' },
        })
      )

      expect(result.current.pagination).toEqual({ pageIndex: 4, pageSize: 50 })
    })

    it('uses custom default page and pageSize', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: {},
          navigate,
          pagination: { defaultPage: 1, defaultPageSize: 20 },
        })
      )

      expect(result.current.pagination).toEqual({ pageIndex: 0, pageSize: 20 })
    })

    it('clamps pageIndex to minimum 0', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: { page: 0 }, navigate }))

      // page 0 => pageIndex = max(0, 0-1) = max(0, -1) = 0
      expect(result.current.pagination.pageIndex).toBe(0)
    })

    it('onPaginationChange navigates with 1-indexed page', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      act(() => {
        result.current.onPaginationChange({ pageIndex: 2, pageSize: 10 })
      })

      expect(navigateCalls.length).toBe(1)
      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.page).toBe(3) // pageIndex 2 => page 3
    })

    it('onPaginationChange omits default page from URL', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      act(() => {
        // Setting page to index 0 = page 1 = default, so should be undefined
        result.current.onPaginationChange({ pageIndex: 0, pageSize: 10 })
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.page).toBeUndefined()
    })

    it('onPaginationChange omits default pageSize from URL', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      act(() => {
        result.current.onPaginationChange({ pageIndex: 0, pageSize: 10 })
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.pageSize).toBeUndefined()
    })

    it('onPaginationChange includes non-default pageSize in URL', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      act(() => {
        result.current.onPaginationChange({ pageIndex: 0, pageSize: 50 })
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.pageSize).toBe(50)
    })

    it('onPaginationChange accepts a function updater', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: { page: 2 }, navigate }))

      act(() => {
        result.current.onPaginationChange((prev) => ({
          pageIndex: prev.pageIndex + 1,
          pageSize: prev.pageSize,
        }))
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      // page 2 = pageIndex 1, + 1 = 2, + 1 for 1-indexing = 3
      expect(patch.page).toBe(3)
    })
  })

  describe('globalFilter', () => {
    it('returns empty string as default global filter', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      expect(result.current.globalFilter).toBe('')
    })

    it('reads global filter from URL search params', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({ search: { filter: 'hello' }, navigate })
      )

      expect(result.current.globalFilter).toBe('hello')
    })

    it('uses custom global filter key', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { q: 'search-term' },
          navigate,
          globalFilter: { key: 'q' },
        })
      )

      expect(result.current.globalFilter).toBe('search-term')
    })

    it('returns undefined when globalFilter is disabled', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: {},
          navigate,
          globalFilter: { enabled: false },
        })
      )

      expect(result.current.globalFilter).toBeUndefined()
      expect(result.current.onGlobalFilterChange).toBeUndefined()
    })

    it('onGlobalFilterChange navigates with the new filter value', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      act(() => {
        result.current.onGlobalFilterChange!('new-filter')
      })

      expect(navigateCalls.length).toBe(1)
      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.filter).toBe('new-filter')
    })

    it('onGlobalFilterChange trims filter value by default', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      act(() => {
        result.current.onGlobalFilterChange!('  trimmed  ')
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.filter).toBe('trimmed')
    })

    it('onGlobalFilterChange does not trim when trim is false', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: {},
          navigate,
          globalFilter: { trim: false },
        })
      )

      act(() => {
        result.current.onGlobalFilterChange!('  not trimmed  ')
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.filter).toBe('  not trimmed  ')
    })

    it('onGlobalFilterChange resets page to undefined', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({ search: { page: 3 }, navigate })
      )

      act(() => {
        result.current.onGlobalFilterChange!('search')
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({ page: 3 })
      expect(patch.page).toBeUndefined()
    })

    it('onGlobalFilterChange sets filter to undefined for empty string', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({ search: { filter: 'old' }, navigate })
      )

      act(() => {
        result.current.onGlobalFilterChange!('')
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({ filter: 'old' })
      expect(patch.filter).toBeUndefined()
    })
  })

  describe('columnFilters', () => {
    it('returns empty column filters when no config is provided', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      expect(result.current.columnFilters).toEqual([])
    })

    it('deserializes string column filter from search params', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { status: 'active' },
          navigate,
          columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'string' }],
        })
      )

      expect(result.current.columnFilters).toEqual([{ id: 'status', value: 'active' }])
    })

    it('ignores empty string column filter values', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { status: '' },
          navigate,
          columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'string' }],
        })
      )

      expect(result.current.columnFilters).toEqual([])
    })

    it('ignores whitespace-only string column filter values', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { status: '   ' },
          navigate,
          columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'string' }],
        })
      )

      expect(result.current.columnFilters).toEqual([])
    })

    it('deserializes array column filter from search params', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { tags: ['a', 'b'] },
          navigate,
          columnFilters: [{ columnId: 'tags', searchKey: 'tags', type: 'array' }],
        })
      )

      expect(result.current.columnFilters).toEqual([{ id: 'tags', value: ['a', 'b'] }])
    })

    it('ignores empty array column filter values', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { tags: [] },
          navigate,
          columnFilters: [{ columnId: 'tags', searchKey: 'tags', type: 'array' }],
        })
      )

      expect(result.current.columnFilters).toEqual([])
    })

    it('uses custom deserialize for column filters', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { status: 'ACTIVE' },
          navigate,
          columnFilters: [
            {
              columnId: 'status',
              searchKey: 'status',
              type: 'string',
              deserialize: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
            },
          ],
        })
      )

      expect(result.current.columnFilters).toEqual([{ id: 'status', value: 'active' }])
    })

    it('onColumnFiltersChange navigates with serialized filter values', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: {},
          navigate,
          columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'string' }],
        })
      )

      act(() => {
        result.current.onColumnFiltersChange([{ id: 'status', value: 'draft' }])
      })

      expect(navigateCalls.length).toBe(1)
      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.status).toBe('draft')
    })

    it('onColumnFiltersChange resets page when filters change', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { page: 5 },
          navigate,
          columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'string' }],
        })
      )

      act(() => {
        result.current.onColumnFiltersChange([{ id: 'status', value: 'active' }])
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({ page: 5 })
      expect(patch.page).toBeUndefined()
    })

    it('onColumnFiltersChange removes filter key when value is empty string', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { status: 'active' },
          navigate,
          columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'string' }],
        })
      )

      act(() => {
        result.current.onColumnFiltersChange([])
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({ status: 'active' })
      expect(patch.status).toBeUndefined()
    })

    it('onColumnFiltersChange uses custom serialize', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: {},
          navigate,
          columnFilters: [
            {
              columnId: 'status',
              searchKey: 'status',
              type: 'string',
              serialize: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
            },
          ],
        })
      )

      act(() => {
        result.current.onColumnFiltersChange([{ id: 'status', value: 'active' }])
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({})
      expect(patch.status).toBe('ACTIVE')
    })

    it('onColumnFiltersChange removes array filter key when value is empty', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({
          search: { tags: ['a'] },
          navigate,
          columnFilters: [{ columnId: 'tags', searchKey: 'tags', type: 'array' }],
        })
      )

      act(() => {
        result.current.onColumnFiltersChange([])
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({ tags: ['a'] })
      expect(patch.tags).toBeUndefined()
    })
  })

  describe('ensurePageInRange', () => {
    it('navigates to first page when current page exceeds pageCount', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({ search: { page: 10 }, navigate })
      )

      act(() => {
        result.current.ensurePageInRange(5)
      })

      expect(navigateCalls.length).toBe(1)
      expect(navigateCalls[0].replace).toBe(true)
      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({ page: 10 })
      expect(patch.page).toBeUndefined() // undefined = default (first page)
    })

    it('navigates to last page when resetTo is "last"', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({ search: { page: 10 }, navigate })
      )

      act(() => {
        result.current.ensurePageInRange(5, { resetTo: 'last' })
      })

      const searchFn = navigateCalls[0].search as (
        prev: Record<string, unknown>
      ) => Record<string, unknown>
      const patch = searchFn({ page: 10 })
      expect(patch.page).toBe(5)
    })

    it('does not navigate when current page is within range', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({ search: { page: 3 }, navigate })
      )

      act(() => {
        result.current.ensurePageInRange(5)
      })

      expect(navigateCalls.length).toBe(0)
    })

    it('does not navigate when pageCount is 0', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({ search: { page: 1 }, navigate })
      )

      act(() => {
        result.current.ensurePageInRange(0)
      })

      expect(navigateCalls.length).toBe(0)
    })

    it('does not navigate when page equals pageCount', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() =>
        useTableUrlState({ search: { page: 5 }, navigate })
      )

      act(() => {
        result.current.ensurePageInRange(5)
      })

      expect(navigateCalls.length).toBe(0)
    })

    it('uses default page when page is not in search params', () => {
      const navigate = createNavigate()
      const { result } = renderHook(() => useTableUrlState({ search: {}, navigate }))

      act(() => {
        // Default page is 1, pageCount is 5, 1 <= 5, so no navigate
        result.current.ensurePageInRange(5)
      })

      expect(navigateCalls.length).toBe(0)
    })
  })
})
