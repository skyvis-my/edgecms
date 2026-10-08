import { useCallback, useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo,
  Redo,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type JSONContent = {
  type?: string
  attrs?: Record<string, unknown>
  content?: JSONContent[]
  marks?: Array<{
    type: string
    attrs?: Record<string, unknown>
    [key: string]: unknown
  }>
  text?: string
  [key: string]: unknown
}

type RichTextEditorProps = {
  value: string | JSONContent | Record<string, unknown> | null | undefined
  onChange: (value: string | JSONContent, json?: JSONContent) => void
  disabled?: boolean
  placeholder?: string
  id?: string
  outputFormat?: 'html' | 'json' | 'both'
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

function parseInitialContent(val: unknown): string | JSONContent {
  if (!val) return ''
  if (typeof val === 'object') return val as JSONContent
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
          return parsed as JSONContent
        }
      } catch {
        // Fall back to treating as html
      }
    }
    return val
  }
  return ''
}

function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        isActive && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  placeholder,
  id,
  outputFormat,
  ...ariaProps
}: RichTextEditorProps) {
  const handleUpdate = useCallback(
    ({
      editor,
    }: {
      editor: {
        getHTML: () => string
        getJSON: () => JSONContent
        isEmpty: boolean
      }
    }) => {
      const html = editor.isEmpty ? '' : editor.getHTML()
      const json = editor.isEmpty ? null : editor.getJSON()
      if (outputFormat === 'json') {
        onChange(json ?? {}, json ?? undefined)
      } else {
        onChange(html, json ?? undefined)
      }
    },
    [onChange, outputFormat],
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          HTMLAttributes: { class: 'underline text-primary' },
        },
      }),
      Image.configure({
        HTMLAttributes: { class: 'rounded-md max-w-full' },
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Start writing...',
      }),
    ],
    content: parseInitialContent(value),
    editable: !disabled,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        id: id || '',
        class:
          'prose dark:prose-invert prose-sm max-w-none px-3 py-2 min-h-[120px] outline-none focus:outline-none',
        ...(ariaProps['aria-invalid'] != null
          ? { 'aria-invalid': String(ariaProps['aria-invalid']) }
          : {}),
        ...(ariaProps['aria-describedby']
          ? { 'aria-describedby': ariaProps['aria-describedby'] }
          : {}),
      },
    },
  })

  // Synchronize external value changes (e.g. async fetch from TanStack Query)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const nextParsed = parseInitialContent(value)
    if (typeof nextParsed === 'string') {
      if (editor.getHTML() !== nextParsed && (nextParsed !== '' || !editor.isEmpty)) {
        editor.commands.setContent(nextParsed, { emitUpdate: false })
      }
    } else if (nextParsed && typeof nextParsed === 'object') {
      const currentJson = editor.getJSON()
      if (JSON.stringify(currentJson) !== JSON.stringify(nextParsed)) {
        editor.commands.setContent(nextParsed, { emitUpdate: false })
      }
    }
  }, [editor, value])

  const addLink = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Enter URL', previousUrl || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const addImage = useCallback(() => {
    if (!editor) return
    const url = window.prompt('Enter image URL', 'https://')
    if (!url) return
    editor.chain().focus().setImage({ src: url }).run()
  }, [editor])

  if (!editor) return null

  return (
    <div
      className={cn(
        'rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        disabled && 'cursor-not-allowed opacity-50',
        ariaProps['aria-invalid'] && 'border-destructive ring-destructive/20',
        'dark:bg-input/30',
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input px-2 py-1">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          disabled={disabled}
          title="Bold"
        >
          <Bold className="size-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          disabled={disabled}
          title="Italic"
        >
          <Italic className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          disabled={disabled}
          title="Heading 1"
        >
          <Heading1 className="size-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          disabled={disabled}
          title="Heading 2"
        >
          <Heading2 className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          disabled={disabled}
          title="Bullet List"
        >
          <List className="size-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          disabled={disabled}
          title="Ordered List"
        >
          <ListOrdered className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          disabled={disabled}
          title="Blockquote"
        >
          <Quote className="size-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive('codeBlock')}
          disabled={disabled}
          title="Code Block"
        >
          <Code className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={addLink}
          isActive={editor.isActive('link')}
          disabled={disabled}
          title="Link"
        >
          <LinkIcon className="size-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={addImage}
          disabled={disabled}
          title="Image"
        >
          <ImageIcon className="size-3.5" />
        </ToolbarButton>

        <div className="mx-1 h-4 w-px bg-border" />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={disabled || !editor.can().undo()}
          title="Undo"
        >
          <Undo className="size-3.5" />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={disabled || !editor.can().redo()}
          title="Redo"
        >
          <Redo className="size-3.5" />
        </ToolbarButton>
      </div>

      {/* Editor Content */}
      <EditorContent editor={editor} />
    </div>
  )
}
