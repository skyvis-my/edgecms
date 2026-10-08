import { describe, expect, it, vi } from 'bun:test'
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { RichTextEditor } from './rich-text-editor'

describe('RichTextEditor', () => {
  it('renders without errors', () => {
    const { container } = render(
      <RichTextEditor value="" onChange={() => {}} />,
    )
    expect(container.querySelector('[contenteditable]')).toBeInTheDocument()
  })

  it('displays initial value', async () => {
    render(
      <RichTextEditor value="<p>Hello world</p>" onChange={() => {}} />,
    )
    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument()
    })
  })

  it('fires onChange when content changes via input event', async () => {
    const handleChange = vi.fn()

    render(
      <RichTextEditor value="" onChange={handleChange} />,
    )

    const editor = document.querySelector('[contenteditable]') as HTMLElement
    expect(editor).toBeInTheDocument()

    // Simulate content change via input event on contenteditable
    editor.innerHTML = '<p>New content</p>'
    fireEvent.input(editor)

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalled()
    })
  })

  it('renders toolbar buttons', () => {
    render(
      <RichTextEditor value="" onChange={() => {}} />,
    )
    expect(screen.getByTitle('Bold')).toBeInTheDocument()
    expect(screen.getByTitle('Italic')).toBeInTheDocument()
    expect(screen.getByTitle('Heading 1')).toBeInTheDocument()
    expect(screen.getByTitle('Heading 2')).toBeInTheDocument()
    expect(screen.getByTitle('Bullet List')).toBeInTheDocument()
    expect(screen.getByTitle('Ordered List')).toBeInTheDocument()
    expect(screen.getByTitle('Blockquote')).toBeInTheDocument()
    expect(screen.getByTitle('Code Block')).toBeInTheDocument()
    expect(screen.getByTitle('Link')).toBeInTheDocument()
    expect(screen.getByTitle('Image')).toBeInTheDocument()
    expect(screen.getByTitle('Undo')).toBeInTheDocument()
    expect(screen.getByTitle('Redo')).toBeInTheDocument()
  })

  it('disables toolbar buttons when disabled', () => {
    render(
      <RichTextEditor value="" onChange={() => {}} disabled />,
    )
    const boldButton = screen.getByTitle('Bold')
    expect(boldButton).toBeDisabled()
  })

  it('displays initial TipTap JSON AST block content object', async () => {
    const ast = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Rendered from JSON AST' }],
        },
      ],
    }
    render(<RichTextEditor value={ast} onChange={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Rendered from JSON AST')).toBeInTheDocument()
    })
  })

  it('displays initial stringified JSON AST content', async () => {
    const jsonStr = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Rendered from stringified JSON AST' }],
        },
      ],
    })
    render(<RichTextEditor value={jsonStr} onChange={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Rendered from stringified JSON AST')).toBeInTheDocument()
    })
  })

  it('fires onChange with both HTML string and JSON AST', async () => {
    const handleChange = vi.fn()
    render(<RichTextEditor value="" onChange={handleChange} />)
    const editor = document.querySelector('[contenteditable]') as HTMLElement
    editor.innerHTML = '<p>Structured paragraph</p>'
    fireEvent.input(editor)
    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'doc' }),
      )
    })
  })

  it('updates editor content when value prop changes dynamically', async () => {
    const { rerender } = render(<RichTextEditor value="<p>Initial text</p>" onChange={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Initial text')).toBeInTheDocument()
    })

    rerender(<RichTextEditor value="<p>Updated text from server</p>" onChange={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Updated text from server')).toBeInTheDocument()
    })
  })
})
