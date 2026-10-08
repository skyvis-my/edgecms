import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Button } from './button'
import { Card } from './card'

describe('luxury motion primitives', () => {
  it('applies reusable motion class to button', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('edge-luxury-interactive')
  })

  it('applies reusable motion class to card', () => {
    render(<Card data-testid='card'>Body</Card>)
    expect(screen.getByTestId('card')).toHaveClass('edge-luxury-surface')
  })
})
