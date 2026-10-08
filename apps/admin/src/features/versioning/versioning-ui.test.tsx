import { describe, expect, it, vi } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionDiff } from './components/version-diff'

describe('Versioning UI', () => {
  it('shows diff and allows rollback', async () => {
    const user = userEvent.setup()
    const onRollback = vi.fn()

    render(
      <VersionDiff
        diffs={[
          {
            field: 'title',
            before: 'Old title',
            after: 'New title',
            action: 'update',
          },
        ]}
        olderVersion={1}
        newerVersion={2}
        onRollback={onRollback}
      />
    )

    const rollbackButton = screen.getByRole('button', { name: 'Rollback' })
    expect(rollbackButton).toBeInTheDocument()

    await user.click(rollbackButton)
    expect(onRollback).toHaveBeenCalledTimes(1)
  })
})
