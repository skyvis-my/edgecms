import { describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { SectionBuilder } from './section-builder'
import type { SectionBlock } from '@edgecms/schemas'

describe('SectionBuilder Field Renderer', () => {
  const defaultField = {
    name: 'sections',
    type: 'sections',
    required: false,
    localizable: false,
  }

  it('renders empty placeholder when no sections exist', () => {
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={[]}
        onChange={() => {}}
        errorId='sections-err'
        field={defaultField}
      />
    )

    expect(screen.getByTestId('section-builder-empty')).toBeDefined()
    expect(screen.getByText('No section blocks added yet')).toBeDefined()
  })

  it('renders existing section blocks with their headings and badges', () => {
    const initialBlocks: SectionBlock[] = [
      {
        id: 'hero-1',
        type: 'hero',
        heading: 'Edge Native CMS',
        subheading: 'Run anywhere',
        alignment: 'center',
      },
      {
        id: 'faq-1',
        type: 'faq',
        title: 'Common Questions',
        items: [{ question: 'How fast?', answer: '0ms cold starts' }],
      },
    ]

    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={() => {}}
        errorId='sections-err'
        field={defaultField}
      />
    )

    expect(screen.getByText('Edge Native CMS')).toBeDefined()
    expect(screen.getByText('Common Questions')).toBeDefined()
    expect(screen.getByText('2 sections configured')).toBeDefined()
  })

  it('calls onChange with a newly added section block when button is clicked', () => {
    const onChange = vi.fn()

    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={[]}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )

    const addHeroBtn = screen.getByTestId('add-section-hero')
    fireEvent.click(addHeroBtn)

    expect(onChange).toHaveBeenCalledTimes(1)
    const [newBlocks] = onChange.mock.calls[0] as [SectionBlock[]]
    expect(newBlocks).toHaveLength(1)
    expect(newBlocks[0]!.type).toBe('hero')
    expect((newBlocks[0] as { heading: string }).heading).toBe('New Hero Section')
  })

  it('removes a section block when delete button is clicked', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      { id: 'b1', type: 'hero', heading: 'Block 1', alignment: 'center' },
      { id: 'b2', type: 'textBlock', title: 'Block 2', content: 'Text', layout: 'narrow' },
    ]

    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )

    const deleteButtons = screen.getAllByLabelText('Delete section')
    expect(deleteButtons).toHaveLength(2)

    fireEvent.click(deleteButtons[0]!)
    expect(onChange).toHaveBeenCalledTimes(1)
    const [updatedBlocks] = onChange.mock.calls[0] as [SectionBlock[]]
    expect(updatedBlocks).toHaveLength(1)
    expect(updatedBlocks[0]!.id).toBe('b2')
  })

  it('reorders blocks up and down', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      { id: 'b1', type: 'hero', heading: 'First', alignment: 'center' },
      { id: 'b2', type: 'textBlock', title: 'Second', content: 'Text', layout: 'narrow' },
    ]

    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )

    // Move first block down
    const moveDownButtons = screen.getAllByLabelText('Move section down')
    fireEvent.click(moveDownButtons[0]!)

    expect(onChange).toHaveBeenCalledTimes(1)
    const [reordered] = onChange.mock.calls[0] as [SectionBlock[]]
    expect(reordered[0]!.id).toBe('b2')
    expect(reordered[1]!.id).toBe('b1')
  })

  it('duplicates an existing block', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      { id: 'b1', type: 'callToAction', heading: 'CTA 1', buttonText: 'Click', buttonUrl: '/go' },
    ]

    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )

    const dupButton = screen.getByLabelText('Duplicate section')
    fireEvent.click(dupButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    const [dupBlocks] = onChange.mock.calls[0] as [SectionBlock[]]
    expect(dupBlocks).toHaveLength(2)
    expect(dupBlocks[0]!.id).toBe('b1')
    expect(dupBlocks[1]!.id).not.toBe('b1')
    expect((dupBlocks[1] as { heading: string }).heading).toBe('CTA 1')
  })

  it('updates field content on input change inside expanded block', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      { id: 'b1', type: 'hero', heading: 'Old Headline', alignment: 'center' },
    ]

    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )

    const headingInput = screen.getByPlaceholderText('Hero main headline')
    fireEvent.change(headingInput, { target: { value: 'New Headline' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const [updated] = onChange.mock.calls[0] as [SectionBlock[]]
    expect((updated[0] as { heading: string }).heading).toBe('New Headline')
  })

  it('parses JSON string currentValue and handles invalid JSON gracefully', () => {
    const validJson = JSON.stringify([
      { id: 'b1', type: 'hero', heading: 'String Parsed Block', alignment: 'center' },
    ])
    const { unmount } = render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={validJson}
        onChange={() => {}}
        errorId='sections-err'
        field={defaultField}
      />
    )
    expect(screen.getByText('String Parsed Block')).toBeDefined()
    unmount()

    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue='invalid-json'
        onChange={() => {}}
        errorId='sections-err'
        field={defaultField}
      />
    )
    expect(screen.getByText('No section blocks added yet')).toBeDefined()
  })

  it('updates hero block fields', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      {
        id: 'h1',
        type: 'hero',
        heading: 'Hero',
        subheading: 'Sub',
        ctaText: 'CTA',
        ctaUrl: '/cta',
        backgroundImageUrl: 'http://img',
        alignment: 'center',
      },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Supporting subheadline text'), {
      target: { value: 'New Sub' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ subheading: 'New Sub' })])
    )

    fireEvent.change(screen.getByPlaceholderText('Get Started'), {
      target: { value: 'Learn More' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ ctaText: 'Learn More' })])
    )

    fireEvent.change(screen.getByPlaceholderText('https://... or /signup'), {
      target: { value: 'https://example.com' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ ctaUrl: 'https://example.com' })])
    )

    fireEvent.change(screen.getByPlaceholderText('https://images.unsplash.com/...'), {
      target: { value: 'https://img.test' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ backgroundImageUrl: 'https://img.test' })])
    )
  })

  it('updates features block and manages feature items', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      {
        id: 'f1',
        type: 'features',
        title: 'Features',
        subtitle: 'Sub',
        columns: 3,
        items: [{ title: 'Feat 1', description: 'Desc 1', icon: 'sparkles' }],
      },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Features title'), {
      target: { value: 'Updated Features' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'Updated Features' })])
    )

    fireEvent.change(screen.getByPlaceholderText('Subtitle or caption'), {
      target: { value: 'New Subtitle' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ subtitle: 'New Subtitle' })])
    )

    fireEvent.change(screen.getByPlaceholderText('Feature title'), {
      target: { value: 'Updated Feat 1' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ title: 'Updated Feat 1' })]),
        }),
      ])
    )

    fireEvent.change(screen.getByPlaceholderText('Feature description'), {
      target: { value: 'Updated Desc 1' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ description: 'Updated Desc 1' })]),
        }),
      ])
    )

    // Add item
    fireEvent.click(screen.getByText('Add Feature'))
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ title: 'New Feature' })]),
        }),
      ])
    )

    // Remove item
    fireEvent.click(screen.getByLabelText('Remove feature item'))
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ items: [] })])
    )
  })

  it('updates textBlock block fields', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      {
        id: 't1',
        type: 'textBlock',
        title: 'Text Title',
        content: 'Initial Content',
        layout: 'narrow',
      },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Optional block title'), {
      target: { value: 'New Block Title' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'New Block Title' })])
    )

    fireEvent.change(screen.getByPlaceholderText('Write your content here...'), {
      target: { value: 'Updated Content' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ content: 'Updated Content' })])
    )
  })

  it('updates imageGallery block and manages image items', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      {
        id: 'g1',
        type: 'imageGallery',
        title: 'Gallery Title',
        layout: 'grid',
        images: [{ url: 'http://img1.jpg', caption: 'Cap 1', alt: 'Alt 1' }],
      },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Gallery title'), {
      target: { value: 'New Gallery Title' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'New Gallery Title' })])
    )

    fireEvent.change(screen.getByPlaceholderText('Image URL *'), {
      target: { value: 'http://updated-img.jpg' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          images: expect.arrayContaining([
            expect.objectContaining({ url: 'http://updated-img.jpg' }),
          ]),
        }),
      ])
    )

    fireEvent.change(screen.getByPlaceholderText('Caption (optional)'), {
      target: { value: 'New Caption' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          images: expect.arrayContaining([expect.objectContaining({ caption: 'New Caption' })]),
        }),
      ])
    )

    fireEvent.change(screen.getByPlaceholderText('Alt text (accessibility)'), {
      target: { value: 'New Alt' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          images: expect.arrayContaining([expect.objectContaining({ alt: 'New Alt' })]),
        }),
      ])
    )

    // Add image
    fireEvent.click(screen.getByText('Add Image'))
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          images: expect.arrayContaining([expect.objectContaining({ caption: '' })]),
        }),
      ])
    )

    // Remove image
    fireEvent.click(screen.getByLabelText('Remove gallery image'))
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ images: [] })])
    )
  })

  it('updates callToAction block fields', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      {
        id: 'c1',
        type: 'callToAction',
        heading: 'CTA Heading',
        description: 'Desc',
        buttonText: 'Click',
        buttonUrl: '/click',
        style: 'primary',
      },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Ready to scale?'), {
      target: { value: 'New Heading' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ heading: 'New Heading' })])
    )

    fireEvent.change(screen.getByPlaceholderText('Call to action body description...'), {
      target: { value: 'New Desc' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ description: 'New Desc' })])
    )

    fireEvent.change(screen.getByPlaceholderText('Start Free Trial'), {
      target: { value: 'Join Now' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ buttonText: 'Join Now' })])
    )

    fireEvent.change(screen.getByPlaceholderText('/pricing'), {
      target: { value: '/signup' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ buttonUrl: '/signup' })])
    )
  })

  it('updates faq block and manages questions', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      {
        id: 'q1',
        type: 'faq',
        title: 'FAQs',
        items: [{ question: 'Q1?', answer: 'A1' }],
      },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Frequently Asked Questions'), {
      target: { value: 'New FAQ Title' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: 'New FAQ Title' })])
    )

    fireEvent.change(screen.getByPlaceholderText('Question *'), {
      target: { value: 'Updated Q1?' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ question: 'Updated Q1?' })]),
        }),
      ])
    )

    fireEvent.change(screen.getByPlaceholderText('Answer *'), {
      target: { value: 'Updated A1' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ answer: 'Updated A1' })]),
        }),
      ])
    )

    // Add question
    fireEvent.click(screen.getByText('Add Question'))
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ question: 'What is the question?' }),
          ]),
        }),
      ])
    )

    // Remove question
    fireEvent.click(screen.getByLabelText('Remove question'))
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ items: [] })])
    )
  })

  it('collapses and expands section block', () => {
    const initialBlocks: SectionBlock[] = [
      { id: 'h1', type: 'hero', heading: 'Hero 1', alignment: 'center' },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={() => {}}
        errorId='sections-err'
        field={defaultField}
      />
    )
    expect(screen.getByPlaceholderText('Hero main headline')).toBeDefined()
    // Collapse
    fireEvent.click(screen.getByLabelText('Collapse section'))
    expect(screen.queryByPlaceholderText('Hero main headline')).toBeNull()
    // Expand again
    fireEvent.click(screen.getByLabelText('Expand section'))
    expect(screen.getByPlaceholderText('Hero main headline')).toBeDefined()
  })

  it('handles drag and drop reordering', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      { id: 'b1', type: 'hero', heading: 'Block 1', alignment: 'center' },
      { id: 'b2', type: 'textBlock', title: 'Block 2', content: 'Text', layout: 'narrow' },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )

    const card1 = screen.getByTestId('section-block-hero-0')
    const card2 = screen.getByTestId('section-block-textBlock-1')

    fireEvent.dragStart(card1)
    fireEvent.dragOver(card1)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.dragOver(card2)
    expect(onChange).toHaveBeenCalledTimes(1)
    const [reordered] = onChange.mock.calls[0] as [SectionBlock[]]
    expect(reordered[0]!.id).toBe('b2')
    expect(reordered[1]!.id).toBe('b1')

    fireEvent.dragEnd(card1)
  })

  it('reorders blocks up with moveBlock', () => {
    const onChange = vi.fn()
    const initialBlocks: SectionBlock[] = [
      { id: 'b1', type: 'hero', heading: 'First', alignment: 'center' },
      { id: 'b2', type: 'textBlock', title: 'Second', content: 'Text', layout: 'narrow' },
    ]
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={initialBlocks}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )

    const moveUpButtons = screen.getAllByLabelText('Move section up')
    fireEvent.click(moveUpButtons[1]!)
    expect(onChange).toHaveBeenCalledTimes(1)
    const [reordered] = onChange.mock.calls[0] as [SectionBlock[]]
    expect(reordered[0]!.id).toBe('b2')
    expect(reordered[1]!.id).toBe('b1')
  })

  it('adds each section block type via add buttons', () => {
    const onChange = vi.fn()
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={[]}
        onChange={onChange}
        errorId='sections-err'
        field={defaultField}
      />
    )

    for (const type of ['features', 'textBlock', 'imageGallery', 'callToAction', 'faq']) {
      fireEvent.click(screen.getByTestId(`add-section-${type}`))
      expect(onChange).toHaveBeenCalled()
      const [blocks] = onChange.mock.calls[onChange.mock.calls.length - 1] as [SectionBlock[]]
      expect(blocks[0]!.type).toBe(type as SectionBlock['type'])
    }
  })

  it('renders error message and singular section count wording', () => {
    render(
      <SectionBuilder
        fieldId='sections-id'
        name='sections'
        currentValue={[{ id: 'h1', type: 'hero', heading: 'Single Hero', alignment: 'center' }]}
        onChange={() => {}}
        errorId='sections-err'
        error='Sections are invalid'
        field={defaultField}
      />
    )

    expect(screen.getByText('1 section configured')).toBeDefined()
    expect(screen.getByText('Sections are invalid')).toBeDefined()
  })
})
