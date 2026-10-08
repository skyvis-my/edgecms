import '../../../test-utils/setup'
import { beforeEach, describe, expect, it, vi } from 'bun:test'

const mockExecuteCommandMutateAsync = vi.fn().mockResolvedValue({})

vi.mock('@/features/commands/use-execute-command', () => ({
  useExecuteCommand: () => ({
    mutateAsync: mockExecuteCommandMutateAsync,
    isPending: false,
  }),
}))

describe('PublishActions regression', () => {
  beforeEach(() => {
    mockExecuteCommandMutateAsync.mockClear()
  })

  it('reverts archived entries to draft through the command endpoint', async () => {
    const { render, screen, waitFor } = await import('@testing-library/react')
    const userEvent = (await import('@testing-library/user-event')).default
    const { PublishActions } = await import('./components/publish-actions')
    const user = userEvent.setup()

    render(
      <PublishActions
        entryId='entry-123'
        collectionSlug='posts'
        currentStatus='archived'
        publishAt={null}
      />
    )

    await user.click(screen.getByText('Revert to Draft'))
    await waitFor(() => {
      expect(
        screen.getByText(
          'This will move the archived entry back to draft so editors can update it before publishing.'
        )
      ).toBeInTheDocument()
    })
    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(mockExecuteCommandMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateEntry',
          payload: expect.objectContaining({
            entryId: 'entry-123',
            status: 'draft',
          }),
        })
      )
    })
  })
})
