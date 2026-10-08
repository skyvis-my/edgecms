import { describe, expect, it } from 'bun:test'
import { render } from '@testing-library/react'

async function importMain() {
  const module = await import(`./main?bypass=${Date.now()}`)
  return module.Main
}

describe('Main', () => {
  it('renders as a main element', async () => {
    const Main = await importMain()
    const { container } = render(<Main>Main Content</Main>)
    expect(container.querySelector('main')).toBeInTheDocument()
  })

  it('applies reusable luxury page animation class', async () => {
    const Main = await importMain()
    const { container } = render(<Main>Main Content</Main>)
    const main = container.querySelector('main')

    expect(main?.className).toContain('edge-luxury-page')
  })
})
