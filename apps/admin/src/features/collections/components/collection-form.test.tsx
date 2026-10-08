import '../../../../test-utils/setup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import {
  type Control,
  type UseFormSetValue,
  useForm,
  useWatch,
} from 'react-hook-form'
import type { CollectionFormValues } from './collection-form'

const navigate = vi.fn()
const createMutateAsync = vi.fn()
const updateMutateAsync = vi.fn()
const writeText = vi.fn().mockResolvedValue(undefined)
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/features/sync/sync-scheduler', () => ({
  triggerSync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/features/tenants/api', () => ({
  useCurrentTenantSlug: () => ({ data: 'acme' }),
  useTenant: () => ({ data: { localeCatalog: ['en', 'ms'] } }),
}))

vi.mock('../api/collections-api', () => ({
  FIELD_TYPES: [
    'text',
    'richtext',
    'markdown',
    'number',
    'boolean',
    'date',
    'media',
    'relation',
    'json',
    'array',
    'select',
    'email',
    'url',
    'slug',
    'color',
  ],
  useCreateCollection: () => ({ mutateAsync: createMutateAsync }),
  useUpdateCollection: () => ({ mutateAsync: updateMutateAsync }),
}))

const { FieldEditor: ActualFieldEditor } = await import(
  `./field-editor?actual=${Date.now()}`
)

vi.mock('./field-editor', () => ({
  FieldEditor: ({
    setValue,
  }: {
    setValue: UseFormSetValue<CollectionFormValues>
  }) => (
    <div data-testid='field-editor'>
      <button
        type='button'
        onClick={() =>
          setValue(
            'fields',
            [
              {
                name: 'author',
                type: 'relation',
                required: true,
                localizable: false,
                options: { relationType: 'one-to-one', targetCollectionId: 'authors' },
              },
              {
                name: 'hero',
                type: 'media',
                required: false,
                localizable: false,
                options: { accept: ['image/*'], maxSizeBytes: 5242880 },
              },
              {
                name: 'blocks',
                type: 'array',
                required: false,
                localizable: true,
                options: {
                  dependsOn: 'author',
                  showWhen: { operator: 'exists' },
                  itemFields: [{ name: 'heading', type: 'text', required: true }],
                },
              },
            ],
            { shouldDirty: true }
          )
        }
      >
        Use semantic fields
      </button>
    </div>
  ),
}))

const { CollectionForm } = await import(`./collection-form?bypass=${Date.now()}`)

beforeEach(() => {
  navigate.mockClear()
  createMutateAsync.mockClear()
  updateMutateAsync.mockClear()
  writeText.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('CollectionForm developer export', () => {
  it('copies current form values as TypeScript config', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const view = render(
      <CollectionForm
        mode='edit'
        collection={{
          id: 'collection-1',
          name: 'Blog Posts',
          slug: 'blog-posts',
          singleton: false,
          fields: [
            {
              name: 'title',
              type: 'text',
              required: true,
              localizable: true,
              options: { component: 'input' },
            },
          ],
          defaultLocale: 'en',
          supportedLocales: ['en', 'ms'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }}
      />
    )

    const nameInput = view.getByLabelText('Collection Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'News Posts')
    await waitFor(() => expect(view.container.textContent).toContain('"name": "News Posts"'))

    fireEvent.click(view.getByRole('button', { name: /copy config/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0]?.[0]).toContain('"name": "News Posts"')
    expect(writeText.mock.calls[0]?.[0]).toContain('"supportedLocales"')
    expect(toastSuccess).toHaveBeenCalledWith('Collection config copied')
  })

  it('submits relation, media, array, and conditional field options with tenant locales', async () => {
    const user = userEvent.setup()
    createMutateAsync.mockResolvedValueOnce({})

    const view = render(<CollectionForm mode='create' />)

    await user.type(view.getByLabelText('Collection Name'), 'Landing Pages')
    await user.click(view.getByRole('button', { name: 'Use semantic fields' }))
    await user.click(view.getByRole('button', { name: 'Create Collection' }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    expect(createMutateAsync.mock.calls[0]?.[0]).toMatchObject({
      name: 'Landing Pages',
      slug: 'landing-pages',
      defaultLocale: 'en',
      supportedLocales: ['en', 'ms'],
      fields: [
        {
          name: 'author',
          type: 'relation',
          required: true,
          localizable: false,
          options: { relationType: 'one-to-one', targetCollectionId: 'authors' },
        },
        {
          name: 'hero',
          type: 'media',
          options: { accept: ['image/*'], maxSizeBytes: 5242880 },
        },
        {
          name: 'blocks',
          type: 'array',
          localizable: true,
          options: {
            dependsOn: 'author',
            showWhen: { operator: 'exists' },
            itemFields: [{ name: 'heading', type: 'text', required: true }],
          },
        },
      ],
    })
  })
})

type FieldEditorComponent = (props: {
  control: Control<CollectionFormValues>
  setValue: UseFormSetValue<CollectionFormValues>
}) => ReactElement

function FieldEditorHarness({
  FieldEditor,
  defaultFields,
}: {
  FieldEditor: FieldEditorComponent
  defaultFields: CollectionFormValues['fields']
}) {
  const form = useForm<CollectionFormValues>({
    defaultValues: {
      name: 'Pages',
      slug: 'pages',
      singleton: false,
      fields: defaultFields,
    },
  })
  const fields = useWatch({ control: form.control, name: 'fields' })

  return (
    <>
      <FieldEditor control={form.control} setValue={form.setValue} />
      <output data-testid='fields-json'>{JSON.stringify(fields)}</output>
    </>
  )
}

describe('FieldEditor', () => {
  it('stores media options as schema-compatible values', async () => {
    const user = userEvent.setup()
    const view = render(
      <FieldEditorHarness
        FieldEditor={ActualFieldEditor}
        defaultFields={[
          {
            name: 'hero',
            type: 'media',
            required: false,
            localizable: false,
            options: { accept: ['image/*', 'application/pdf'] },
          },
        ]}
      />
    )

    await user.type(view.getByLabelText('Max Size (bytes)'), '2048')

    await waitFor(() => {
      const fields = JSON.parse(view.getByTestId('fields-json').textContent ?? '[]')
      expect(fields[0].options).toEqual({
        accept: ['image/*', 'application/pdf'],
        maxSizeBytes: 2048,
      })
    })
  })

  it('reorders and removes fields through React Hook Form field arrays', async () => {
    const user = userEvent.setup()
    const view = render(
      <FieldEditorHarness
        FieldEditor={ActualFieldEditor}
        defaultFields={[
          { name: 'title', type: 'text', required: true, localizable: false },
          { name: 'summary', type: 'text', required: false, localizable: false },
        ]}
      />
    )

    await user.click(view.getAllByRole('button', { name: 'Move down' })[0])
    await waitFor(() => {
      const fields = JSON.parse(view.getByTestId('fields-json').textContent ?? '[]')
      expect(fields.map((field: { name: string }) => field.name)).toEqual(['summary', 'title'])
    })

    await user.click(view.getAllByRole('button', { name: 'Remove field' })[0])
    await waitFor(() => {
      const fields = JSON.parse(view.getByTestId('fields-json').textContent ?? '[]')
      expect(fields.map((field: { name: string }) => field.name)).toEqual(['title'])
    })
  })

  it('clears conditional dependsOn when the source field is renamed', async () => {
    const user = userEvent.setup()
    const view = render(
      <FieldEditorHarness
        FieldEditor={ActualFieldEditor}
        defaultFields={[
          { name: 'title', type: 'text', required: true, localizable: false },
          {
            name: 'summary',
            type: 'text',
            required: false,
            localizable: false,
            options: {
              dependsOn: 'title',
              showWhen: { operator: 'exists' },
            },
          },
        ]}
      />
    )

    const sourceNameInput = view.getAllByLabelText('Field Name')[0]
    await user.clear(sourceNameInput)
    await user.type(sourceNameInput, 'heading')

    await waitFor(() => {
      const fields = JSON.parse(view.getByTestId('fields-json').textContent ?? '[]')
      expect(fields[0].name).toBe('heading')
      expect(fields[1].options.dependsOn).toBeUndefined()
      expect(fields[1].options.showWhen).toBeUndefined()
    })
  })

  it('keeps relation fields and array subfields behind type-specific controls', async () => {
    const user = userEvent.setup()
    const view = render(
      <FieldEditorHarness
        FieldEditor={ActualFieldEditor}
        defaultFields={[
          {
            name: 'author',
            type: 'relation',
            required: false,
            localizable: false,
            options: { relationType: 'one-to-many', targetCollectionId: '' },
          },
          {
            name: 'blocks',
            type: 'array',
            required: false,
            localizable: false,
            options: { itemFields: [{ name: 'heading', type: 'text', required: true }] },
          },
        ]}
      />
    )

    await user.type(view.getByLabelText('Target Collection ID'), 'authors')
    await user.click(view.getByRole('button', { name: 'Add Subfield' }))

    await waitFor(() => {
      const fields = JSON.parse(view.getByTestId('fields-json').textContent ?? '[]')
      expect(fields[0].options.targetCollectionId).toBe('authors')
      expect(fields[1].options.itemFields).toHaveLength(2)
      expect(fields[1].options.itemFields[1]).toEqual({
        name: '',
        type: 'text',
        required: false,
      })
    })
  })
})
