import '../../../../../test-utils/setup'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { SelectField } from './select-field'
import { BooleanField } from './boolean-field'
import { ColorField } from './color-field'
import { DateField } from './date-field'
import { SlugField } from './slug-field'
import { RichTextField, TextField } from './text-field'
import { NumberField } from './number-field'
import { JsonField } from './json-field'
import { DefaultField } from './default-field'
import { EmailField } from './email-field'
import { MarkdownField } from './markdown-field'
import { UrlField } from './url-field'
import type { FieldDefinition } from '@/features/collections/api/collections-api'

const baseField: FieldDefinition = {
  name: 'title',
  type: 'text',
  required: false,
  localizable: false,
}

describe('Field Renderers', () => {
  describe('SelectField', () => {
    it('renders single select dropdown and handles value changes', () => {
      const onChange = mock()
      const fieldWithOptions: FieldDefinition = {
        ...baseField,
        type: 'select',
        options: {
          choices: [
            { value: 'opt1', label: 'Option 1' },
            { value: 'opt2', label: 'Option 2' },
          ],
          placeholder: 'Select an option',
        },
      }

      render(
        <SelectField
          fieldId='select-1'
          name='Category'
          currentValue='opt1'
          onChange={onChange}
          field={fieldWithOptions}
        />
      )

      expect(screen.getByRole('combobox')).toBeInTheDocument()
      expect(screen.getByText('Option 1')).toBeInTheDocument()
    })

    it('renders multiple choice checkboxes when multiple is true', () => {
      const onChange = mock()
      const fieldWithOptions: FieldDefinition = {
        ...baseField,
        type: 'select',
        options: {
          multiple: true,
          choices: [
            { value: 'tag1', label: 'Tag 1' },
            { value: 'tag2', label: 'Tag 2' },
          ],
        },
      }

      render(
        <SelectField
          fieldId='select-multi'
          name='Tags'
          currentValue={['tag1']}
          onChange={onChange}
          field={fieldWithOptions}
        />
      )

      const tag1Checkbox = screen.getByLabelText('Tag 1') as HTMLInputElement
      const tag2Checkbox = screen.getByLabelText('Tag 2') as HTMLInputElement

      expect(tag1Checkbox.checked).toBe(true)
      expect(tag2Checkbox.checked).toBe(false)

      fireEvent.click(tag2Checkbox)
      expect(onChange).toHaveBeenCalledWith(['tag1', 'tag2'])

      fireEvent.click(tag1Checkbox)
      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  describe('BooleanField', () => {
    it('renders switch with Yes/No label and handles toggle', () => {
      const onChange = mock()
      const { rerender } = render(
        <BooleanField
          fieldId='bool-1'
          name='Featured'
          currentValue={false}
          onChange={onChange}
          field={{ ...baseField, type: 'boolean' }}
        />
      )

      expect(screen.getByText('No')).toBeInTheDocument()
      const switchEl = screen.getByRole('switch')
      expect(switchEl).not.toBeChecked()

      fireEvent.click(switchEl)
      expect(onChange).toHaveBeenCalledWith(true)

      rerender(
        <BooleanField
          fieldId='bool-1'
          name='Featured'
          currentValue={true}
          onChange={onChange}
          field={{ ...baseField, type: 'boolean' }}
        />
      )
      expect(screen.getByText('Yes')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeChecked()
    })
  })

  describe('ColorField', () => {
    it('renders color picker and text input and syncs changes', () => {
      const onChange = mock()
      render(
        <ColorField
          fieldId='color-1'
          name='Accent'
          currentValue='#ff0000'
          onChange={onChange}
          field={{ ...baseField, type: 'color' }}
        />
      )

      const textInput = screen.getByPlaceholderText('#000000')
      expect(textInput).toHaveValue('#ff0000')

      fireEvent.change(textInput, { target: { value: '#00ff00' } })
      expect(onChange).toHaveBeenCalledWith('#00ff00')
    })
  })

  describe('DateField', () => {
    it('renders datetime-local input and formats values', () => {
      const onChange = mock()
      const dateIso = '2026-05-15T10:30:00.000Z'

      render(
        <DateField
          fieldId='date-1'
          name='PublishedAt'
          currentValue={dateIso}
          onChange={onChange}
          field={{ ...baseField, type: 'date' }}
        />
      )

      const input = document.getElementById('date-1') as HTMLInputElement
      expect(input).toBeInTheDocument()
      expect(input.type).toBe('datetime-local')

      fireEvent.change(input, { target: { value: '2026-05-20T12:00' } })
      expect(onChange).toHaveBeenCalled()

      fireEvent.change(input, { target: { value: '' } })
      expect(onChange).toHaveBeenCalledWith(null)
    })
  })

  describe('SlugField', () => {
    it('slugifies typed text and shows helper when generateFrom is configured', () => {
      const onChange = mock()
      render(
        <SlugField
          fieldId='slug-1'
          name='Slug'
          currentValue='my-first-post'
          onChange={onChange}
          field={{
            ...baseField,
            type: 'slug',
            options: { generateFrom: 'title' },
          }}
        />
      )

      expect(screen.getByText('Auto-generated from title')).toBeInTheDocument()
      const input = screen.getByPlaceholderText('Enter Slug')
      expect(input).toHaveValue('my-first-post')

      fireEvent.change(input, { target: { value: 'Hello World & Beyond!' } })
      expect(onChange).toHaveBeenCalledWith('hello-world-beyond')
    })
  })

  describe('TextField', () => {
    it('renders single line input by default', () => {
      const onChange = mock()
      render(
        <TextField
          fieldId='txt-1'
          name='Heading'
          currentValue='Sample Title'
          onChange={onChange}
          field={baseField}
        />
      )

      const input = screen.getByPlaceholderText('Enter Heading')
      expect(input.tagName).toBe('INPUT')
      fireEvent.change(input, { target: { value: 'Updated Title' } })
      expect(onChange).toHaveBeenCalledWith('Updated Title')
    })

    it('renders textarea when options.component is textarea', () => {
      const onChange = mock()
      render(
        <TextField
          fieldId='txt-area'
          name='Bio'
          currentValue='Some bio'
          onChange={onChange}
          field={{
            ...baseField,
            options: { component: 'textarea' },
          }}
        />
      )

      const textarea = screen.getByPlaceholderText('Enter Bio')
      expect(textarea.tagName).toBe('TEXTAREA')
    })
  })

  describe('NumberField', () => {
    it('renders number input and parses numeric value', () => {
      const onChange = mock()
      render(
        <NumberField
          fieldId='num-1'
          name='Priority'
          currentValue={42}
          onChange={onChange}
          field={{ ...baseField, type: 'number' }}
        />
      )

      const input = screen.getByPlaceholderText('Enter Priority')
      expect(input).toHaveValue(42)

      fireEvent.change(input, { target: { value: '99' } })
      expect(onChange).toHaveBeenCalledWith(99)

      fireEvent.change(input, { target: { value: '' } })
      expect(onChange).toHaveBeenCalledWith(null)
    })
  })

  describe('JsonField', () => {
    it('formats object as JSON string and allows raw text editing', () => {
      const onChange = mock()
      render(
        <JsonField
          fieldId='json-1'
          name='Config'
          currentValue={{ enabled: true, count: 5 }}
          onChange={onChange}
          field={{ ...baseField, type: 'json' }}
        />
      )

      const textarea = screen.getByPlaceholderText('Enter valid JSON')
      expect(textarea).toHaveValue(JSON.stringify({ enabled: true, count: 5 }, null, 2))

      fireEvent.change(textarea, { target: { value: '{"key": "val"}' } })
      expect(onChange).toHaveBeenCalledWith('{"key": "val"}')
    })

    it('handles null/undefined value gracefully', () => {
      const onChange = mock()
      render(
        <JsonField
          fieldId='json-empty'
          name='Config'
          currentValue={null}
          onChange={onChange}
          field={{ ...baseField, type: 'json' }}
        />
      )

      const textarea = screen.getByPlaceholderText('Enter valid JSON')
      expect(textarea).toHaveValue('')
    })
  })

  describe('DefaultField', () => {
    it('renders input fallback with string coercion', () => {
      const onChange = mock()
      render(
        <DefaultField
          fieldId='def-1'
          name='Misc'
          currentValue={1234}
          onChange={onChange}
          field={baseField}
        />
      )

      const input = screen.getByPlaceholderText('Enter Misc')
      expect(input).toHaveValue('1234')
      fireEvent.change(input, { target: { value: 'custom' } })
      expect(onChange).toHaveBeenCalledWith('custom')
    })
  })

  describe('EmailField, MarkdownField, UrlField', () => {
    it('renders EmailField properly', () => {
      const onChange = mock()
      render(
        <EmailField
          fieldId='email-1'
          name='Contact'
          currentValue='user@example.com'
          onChange={onChange}
          field={{ ...baseField, type: 'email' }}
        />
      )

      const input = screen.getByPlaceholderText('Enter Contact')
      expect(input).toHaveValue('user@example.com')
      fireEvent.change(input, { target: { value: 'other@example.com' } })
      expect(onChange).toHaveBeenCalledWith('other@example.com')
    })

    it('renders MarkdownField properly', () => {
      const onChange = mock()
      render(
        <MarkdownField
          fieldId='md-1'
          name='Body'
          currentValue='# Header'
          onChange={onChange}
          field={{ ...baseField, type: 'markdown' }}
        />
      )

      const textarea = screen.getByPlaceholderText('Enter Body')
      expect(textarea).toHaveValue('# Header')
      fireEvent.change(textarea, { target: { value: '## New' } })
      expect(onChange).toHaveBeenCalledWith('## New')
    })

    it('renders UrlField properly', () => {
      const onChange = mock()
      render(
        <UrlField
          fieldId='url-1'
          name='Link'
          currentValue='https://example.com'
          onChange={onChange}
          field={{ ...baseField, type: 'url' }}
        />
      )

      const input = screen.getByPlaceholderText('Enter Link')
      expect(input).toHaveValue('https://example.com')
      fireEvent.change(input, { target: { value: 'https://test.org' } })
      expect(onChange).toHaveBeenCalledWith('https://test.org')
    })

    it('renders RichTextField with lazy loaded editor component', async () => {
      const onChange = mock()
      render(
        <RichTextField
          fieldId='rich-1'
          name='Content'
          currentValue='<p>Hello world</p>'
          onChange={onChange}
          field={{ ...baseField, type: 'richtext' }}
        />
      )

      // The lazy component resolves and renders the rich text editor container
      expect(await screen.findByRole('textbox')).toBeInTheDocument()
    })
  })
})

