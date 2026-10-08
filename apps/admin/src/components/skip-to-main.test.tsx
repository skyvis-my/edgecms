import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { SkipToMain } from './skip-to-main'

describe('SkipToMain', () => {
  it('renders a skip link to #content', () => {
    render(<SkipToMain />)

    const link = screen.getByRole('link', { name: 'Skip to Main' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '#content')
  })
})
