import { describe, expect, it } from 'bun:test'
import { cn, getPageNumbers, sleep } from './utils'

describe('utils', () => {
  it('cn merges class names and resolves conflicts', () => {
    expect(cn('px-2', 'px-4', 'text-sm')).toBe('px-4 text-sm')
  })

  it('sleep resolves after awaited duration', async () => {
    await expect(sleep(0)).resolves.toBeUndefined()
  })

  it('getPageNumbers returns all pages when totalPages <= 5', () => {
    expect(getPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('getPageNumbers returns beginning layout', () => {
    expect(getPageNumbers(2, 10)).toEqual([1, 2, 3, 4, '...', 10])
  })

  it('getPageNumbers returns middle layout', () => {
    expect(getPageNumbers(5, 10)).toEqual([1, '...', 4, 5, 6, '...', 10])
  })

  it('getPageNumbers returns ending layout', () => {
    expect(getPageNumbers(9, 10)).toEqual([1, '...', 7, 8, 9, 10])
  })
})
