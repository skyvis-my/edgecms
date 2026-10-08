import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { WorkflowPanel } from './workflows/workflow-panel'

describe('WorkflowPanel', () => {
  it('renders workflow steps with progress', async () => {
    render(
      <WorkflowPanel
        steps={[
          {
            id: '1',
            label: 'Generate command set',
            status: 'running',
          },
        ]}
      />
    )

    expect(screen.getByText('Generate command set')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
  })
})
