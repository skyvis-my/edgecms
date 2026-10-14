import { describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { FieldDefinition } from '@/features/collections/api/collections-api'
import type { ArrayItemSubfield } from '@/features/entries/components/field-renderer-utils'
import { ArrayField } from './array-field'

const defaultField: FieldDefinition = {
  id: 'f1',
  name: 'tags',
  label: 'Tags',
  type: 'array',
  required: false,
}

describe('ArrayField', () => {
  describe('SimpleArrayField (no subfields)', () => {
    it('renders textarea with formatted text value', () => {
      const onChange = vi.fn()
      render(
        <ArrayField
          fieldId='tags-id'
          name='tags'
          field={defaultField}
          currentValue={['news', 'updates']}
          onChange={onChange}
          itemSubfields={[]}
        />
      )

      const textarea = screen.getByPlaceholderText('Enter one tags value per line') as HTMLTextAreaElement
      expect(textarea.value).toBe('news\nupdates')
    })

    it('calls onChange with parsed array when text changes', () => {
      const onChange = vi.fn()
      render(
        <ArrayField
          fieldId='tags-id'
          name='tags'
          field={defaultField}
          currentValue={[]}
          onChange={onChange}
          itemSubfields={[]}
        />
      )

      const textarea = screen.getByPlaceholderText('Enter one tags value per line')
      fireEvent.change(textarea, { target: { value: 'tag1\ntag2\ntag3' } })

      expect(onChange).toHaveBeenCalledWith(['tag1', 'tag2', 'tag3'])
    })

    it('sets aria-invalid and aria-describedby when error is present', () => {
      render(
        <ArrayField
          fieldId='tags-id'
          name='tags'
          field={defaultField}
          currentValue={[]}
          onChange={() => {}}
          itemSubfields={[]}
          error='Tags are required'
          errorId='tags-err'
        />
      )

      const textarea = screen.getByPlaceholderText('Enter one tags value per line')
      expect(textarea.getAttribute('aria-invalid')).toBe('true')
      expect(textarea.getAttribute('aria-describedby')).toBe('tags-err')
    })
  })

  describe('ArrayObjectField (with subfields)', () => {
    const subfields: ArrayItemSubfield[] = [
      { name: 'title', type: 'text', required: true },
      { name: 'count', type: 'number', required: false },
      { name: 'active', type: 'boolean', required: false },
      { name: 'publishedAt', type: 'date', required: false },
      { name: 'metadata', type: 'json', required: false },
    ]

    it('renders object subfields and adds a new item default', () => {
      const onChange = vi.fn()
      render(
        <ArrayField
          fieldId='items-id'
          name='items'
          field={defaultField}
          currentValue={[]}
          onChange={onChange}
          itemSubfields={subfields}
        />
      )

      const addButton = screen.getByText('Add Item')
      fireEvent.click(addButton)

      expect(onChange).toHaveBeenCalledTimes(1)
      const [items] = onChange.mock.calls[0] as [Array<Record<string, unknown>>]
      expect(items).toHaveLength(1)
      expect(items[0]).toBeDefined()
    })

    it('removes an item by index', () => {
      const onChange = vi.fn()
      const initialItems = [
        { title: 'Item 1', count: 1 },
        { title: 'Item 2', count: 2 },
      ]

      render(
        <ArrayField
          fieldId='items-id'
          name='items'
          field={defaultField}
          currentValue={initialItems}
          onChange={onChange}
          itemSubfields={subfields}
        />
      )

      const removeButtons = screen.getAllByText('Remove')
      expect(removeButtons).toHaveLength(2)

      fireEvent.click(removeButtons[0]!)
      expect(onChange).toHaveBeenCalledWith([{ title: 'Item 2', count: 2 }])
    })

    it('updates text subfield value', () => {
      const onChange = vi.fn()
      const initialItems = [{ title: 'Old Title', count: 5 }]

      render(
        <ArrayField
          fieldId='items-id'
          name='items'
          field={defaultField}
          currentValue={initialItems}
          onChange={onChange}
          itemSubfields={subfields}
        />
      )

      const titleInput = screen.getByDisplayValue('Old Title')
      fireEvent.change(titleInput, { target: { value: 'New Title' } })

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'New Title', count: 5 }),
      ])
    })

    it('updates number subfield value', () => {
      const onChange = vi.fn()
      const initialItems = [{ title: 'Item', count: 5 }]

      render(
        <ArrayField
          fieldId='items-id'
          name='items'
          field={defaultField}
          currentValue={initialItems}
          onChange={onChange}
          itemSubfields={subfields}
        />
      )

      const countInput = screen.getByDisplayValue('5')
      fireEvent.change(countInput, { target: { value: '42' } })

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'Item', count: 42 }),
      ])

      fireEvent.change(countInput, { target: { value: '' } })
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'Item', count: null }),
      ])
    })

    it('updates boolean subfield value via Switch', () => {
      const onChange = vi.fn()
      const initialItems = [{ title: 'Item', active: false }]

      render(
        <ArrayField
          fieldId='items-id'
          name='items'
          field={defaultField}
          currentValue={initialItems}
          onChange={onChange}
          itemSubfields={subfields}
        />
      )

      const switchBtn = screen.getByRole('switch')
      fireEvent.click(switchBtn)

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'Item', active: true }),
      ])
    })

    it('updates date subfield value', () => {
      const onChange = vi.fn()
      const initialItems = [{ title: 'Item', publishedAt: '2026-06-15T10:00:00.000Z' }]

      render(
        <ArrayField
          fieldId='items-id'
          name='items'
          field={defaultField}
          currentValue={initialItems}
          onChange={onChange}
          itemSubfields={subfields}
        />
      )

      const dateInput = screen.getByDisplayValue('2026-06-15T10:00')
      fireEvent.change(dateInput, { target: { value: '2026-07-01T12:00' } })

      expect(onChange).toHaveBeenCalledTimes(1)
      const [items] = onChange.mock.calls[0] as [Array<Record<string, unknown>>]
      expect(typeof items[0]!.publishedAt).toBe('string')

      fireEvent.change(dateInput, { target: { value: '' } })
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'Item', publishedAt: null }),
      ])
    })

    it('updates json subfield value', () => {
      const onChange = vi.fn()
      const initialItems = [{ title: 'Item', metadata: { key: 'val' } }]

      render(
        <ArrayField
          fieldId='items-id'
          name='items'
          field={defaultField}
          currentValue={initialItems}
          onChange={onChange}
          itemSubfields={subfields}
        />
      )

      const jsonTextarea = screen.getByRole('textbox', { name: 'metadata' })
      fireEvent.change(jsonTextarea, { target: { value: '{"updated": true}' } })

      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ title: 'Item', metadata: '{"updated": true}' }),
      ])
    })

    it('renders required indicator for required subfields', () => {
      render(
        <ArrayField
          fieldId='items-id'
          name='items'
          field={defaultField}
          currentValue={[{ title: 'Required Test' }]}
          onChange={() => {}}
          itemSubfields={subfields}
        />
      )

      expect(screen.getByText('required')).toBeDefined()
    })
  })
})
