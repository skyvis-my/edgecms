import { describe, expect, it } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import useDialogState from './use-dialog-state'

describe('useDialogState', () => {
  it('uses null as default initial state', () => {
    const { result } = renderHook(() => useDialogState<'approve' | 'reject'>())
    expect(result.current[0]).toBeNull()
  })

  it('toggles selected state on repeated value', () => {
    const { result } = renderHook(() => useDialogState<'approve' | 'reject'>())

    act(() => {
      result.current[1]('approve')
    })
    expect(result.current[0]).toBe('approve')

    act(() => {
      result.current[1]('approve')
    })
    expect(result.current[0]).toBeNull()
  })

  it('switches between values', () => {
    const { result } = renderHook(() => useDialogState<'approve' | 'reject'>('reject'))

    expect(result.current[0]).toBe('reject')

    act(() => {
      result.current[1]('approve')
    })

    expect(result.current[0]).toBe('approve')
  })
})
