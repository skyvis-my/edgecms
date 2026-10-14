import { useState } from 'react'
import {
  createDefaultSectionBlock,
  supportedSectionBlockTypes,
  type CallToActionSectionBlock,
  type FaqSectionBlock,
  type FeaturesSectionBlock,
  type HeroSectionBlock,
  type ImageGallerySectionBlock,
  type SectionBlock,
  type SectionBlockType,
  type TextBlockSectionBlock,
} from '@edgecms/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
  Sparkles,
  Layers,
  FileText,
  Image as ImageIcon,
  Megaphone,
  HelpCircle,
} from 'lucide-react'
import type { FieldTypeProps } from './types'

const BLOCK_TYPE_INFO: Record<
  SectionBlockType,
  { label: string; icon: typeof Sparkles; description: string; color: string }
> = {
  hero: {
    label: 'Hero',
    icon: Sparkles,
    description: 'Prominent header banner with headline and CTA',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  features: {
    label: 'Features',
    icon: Layers,
    description: 'Grid of feature highlights or product pillars',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  textBlock: {
    label: 'Text Block',
    icon: FileText,
    description: 'Longform rich text or editorial narrative',
    color: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  imageGallery: {
    label: 'Image Gallery',
    icon: ImageIcon,
    description: 'Visual gallery with grid or masonry layout',
    color: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  callToAction: {
    label: 'Call to Action',
    icon: Megaphone,
    description: 'High-conversion button banner with heading',
    color: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  faq: {
    label: 'FAQ',
    icon: HelpCircle,
    description: 'Frequently asked questions and answers',
    color: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  },
}

function parseBlocks(value: unknown): SectionBlock[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is SectionBlock =>
        item && typeof item === 'object' && typeof (item as SectionBlock).type === 'string'
    )
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parseBlocks(parsed)
      }
    } catch {
      // Return empty array on parse failure
    }
  }
  return []
}

export function SectionBuilder({
  fieldId,
  name: _name,
  currentValue,
  onChange,
  disabled,
  error,
  errorId,
}: FieldTypeProps) {
  const blocks = parseBlocks(currentValue)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(blocks.map((b) => b.id))
  )
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const updateBlocks = (newBlocks: SectionBlock[]) => {
    onChange(newBlocks)
  }

  const addBlock = (type: SectionBlockType) => {
    const newBlock = createDefaultSectionBlock(type)
    const nextBlocks = [...blocks, newBlock]
    updateBlocks(nextBlocks)
    setExpandedIds((prev) => new Set(prev).add(newBlock.id))
  }

  const removeBlock = (index: number) => {
    const nextBlocks = blocks.filter((_, i) => i !== index)
    updateBlocks(nextBlocks)
  }

  const duplicateBlock = (index: number) => {
    const original = blocks[index]
    if (!original) return
    const duplicated: SectionBlock = {
      ...structuredClone(original),
      id: `sec_${Math.random().toString(36).substring(2, 9)}`,
    }
    const nextBlocks = [...blocks]
    nextBlocks.splice(index + 1, 0, duplicated)
    updateBlocks(nextBlocks)
    setExpandedIds((prev) => new Set(prev).add(duplicated.id))
  }

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= blocks.length) return
    const nextBlocks = [...blocks]
    const [moved] = nextBlocks.splice(index, 1)
    if (moved) {
      nextBlocks.splice(targetIndex, 0, moved)
      updateBlocks(nextBlocks)
    }
  }

  const updateBlockData = <T extends SectionBlock>(index: number, patch: Partial<T>) => {
    const nextBlocks = [...blocks]
    const current = nextBlocks[index]
    if (current) {
      nextBlocks[index] = { ...current, ...patch } as SectionBlock
      updateBlocks(nextBlocks)
    }
  }

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return
    const nextBlocks = [...blocks]
    const [dragged] = nextBlocks.splice(draggedIndex, 1)
    if (dragged) {
      nextBlocks.splice(index, 0, dragged)
      setDraggedIndex(index)
      updateBlocks(nextBlocks)
    }
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  return (
    <div id={fieldId} data-testid='section-builder' className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <span className='text-xs text-muted-foreground'>
            {blocks.length} {blocks.length === 1 ? 'section' : 'sections'} configured
          </span>
        </div>
      </div>

      {blocks.length === 0 ? (
        <div
          data-testid='section-builder-empty'
          className='flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center bg-muted/20'
        >
          <Layers className='size-8 text-muted-foreground/60 mb-2' />
          <h4 className='text-sm font-semibold'>No section blocks added yet</h4>
          <p className='text-xs text-muted-foreground mt-1 max-w-sm'>
            Build dynamic visual pages by stacking polymorphic content blocks like Hero, Features, Text, and Galleries.
          </p>
        </div>
      ) : (
        <div className='space-y-3' data-testid='section-blocks-list'>
          {blocks.map((block, index) => {
            const info = BLOCK_TYPE_INFO[block.type] || {
              label: block.type,
              icon: Layers,
              color: 'bg-gray-100 text-gray-800',
            }
            const Icon = info.icon
            const isExpanded = expandedIds.has(block.id)

            // Block summary title
            let blockTitle = ''
            if ('heading' in block && block.heading) blockTitle = block.heading
            else if ('title' in block && block.title) blockTitle = block.title
            else blockTitle = info.label

            return (
              <Card
                key={block.id}
                data-testid={`section-block-${block.type}-${index}`}
                draggable={!disabled}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`transition-all duration-150 border ${
                  draggedIndex === index ? 'opacity-50 ring-2 ring-primary' : ''
                }`}
              >
                {/* Header Toolbar */}
                <div className='flex items-center gap-2 p-3 bg-muted/30 border-b select-none'>
                  <div
                    className='cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground'
                    title='Drag to reorder'
                  >
                    <GripVertical className='size-4' />
                  </div>

                  <Badge variant='outline' className={`text-xs gap-1 py-0.5 px-2 ${info.color}`}>
                    <Icon className='size-3' />
                    {info.label}
                  </Badge>

                  <span className='text-xs font-medium text-foreground truncate max-w-xs sm:max-w-md'>
                    {blockTitle}
                  </span>

                  <div className='ml-auto flex items-center gap-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-7'
                      disabled={disabled || index === 0}
                      onClick={() => moveBlock(index, 'up')}
                      aria-label='Move section up'
                    >
                      <ChevronUp className='size-3.5' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-7'
                      disabled={disabled || index === blocks.length - 1}
                      onClick={() => moveBlock(index, 'down')}
                      aria-label='Move section down'
                    >
                      <ChevronDown className='size-3.5' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-7'
                      disabled={disabled}
                      onClick={() => duplicateBlock(index)}
                      aria-label='Duplicate section'
                    >
                      <Copy className='size-3.5' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-7 text-destructive hover:bg-destructive/10'
                      disabled={disabled}
                      onClick={() => removeBlock(index)}
                      aria-label='Delete section'
                    >
                      <Trash2 className='size-3.5' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-7'
                      onClick={() => toggleExpand(block.id)}
                      aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
                    >
                      <ChevronDown
                        className={`size-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </Button>
                  </div>
                </div>

                {/* Form Fields for Section */}
                {isExpanded && (
                  <CardContent className='p-4 space-y-4'>
                    {block.type === 'hero' && (
                      <HeroBlockEditor
                        block={block as HeroSectionBlock}
                        disabled={disabled}
                        onChange={(patch) => updateBlockData<HeroSectionBlock>(index, patch)}
                      />
                    )}
                    {block.type === 'features' && (
                      <FeaturesBlockEditor
                        block={block as FeaturesSectionBlock}
                        disabled={disabled}
                        onChange={(patch) => updateBlockData<FeaturesSectionBlock>(index, patch)}
                      />
                    )}
                    {block.type === 'textBlock' && (
                      <TextBlockEditor
                        block={block as TextBlockSectionBlock}
                        disabled={disabled}
                        onChange={(patch) => updateBlockData<TextBlockSectionBlock>(index, patch)}
                      />
                    )}
                    {block.type === 'imageGallery' && (
                      <ImageGalleryEditor
                        block={block as ImageGallerySectionBlock}
                        disabled={disabled}
                        onChange={(patch) => updateBlockData<ImageGallerySectionBlock>(index, patch)}
                      />
                    )}
                    {block.type === 'callToAction' && (
                      <CallToActionEditor
                        block={block as CallToActionSectionBlock}
                        disabled={disabled}
                        onChange={(patch) => updateBlockData<CallToActionSectionBlock>(index, patch)}
                      />
                    )}
                    {block.type === 'faq' && (
                      <FaqBlockEditor
                        block={block as FaqSectionBlock}
                        disabled={disabled}
                        onChange={(patch) => updateBlockData<FaqSectionBlock>(index, patch)}
                      />
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Add Block Toolbar */}
      <div className='flex flex-wrap items-center gap-2 pt-2'>
        <span className='text-xs font-medium text-muted-foreground mr-1'>Add Section:</span>
        {supportedSectionBlockTypes.map((type) => {
          const info = BLOCK_TYPE_INFO[type]
          const Icon = info.icon
          return (
            <Button
              key={type}
              type='button'
              variant='outline'
              size='sm'
              className='h-8 text-xs gap-1.5'
              disabled={disabled}
              onClick={() => addBlock(type)}
              data-testid={`add-section-${type}`}
            >
              <Icon className='size-3.5' />
              {info.label}
            </Button>
          )
        })}
      </div>

      {error && (
        <p id={errorId} className='text-xs text-destructive font-medium'>
          {error}
        </p>
      )}
    </div>
  )
}

/* ========================================================================= */
/* BLOCK SPECIFIC SUB-EDITORS                                                */
/* ========================================================================= */

function HeroBlockEditor({
  block,
  disabled,
  onChange,
}: {
  block: HeroSectionBlock
  disabled?: boolean
  onChange: (patch: Partial<HeroSectionBlock>) => void
}) {
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
      <div className='space-y-1.5 md:col-span-2'>
        <Label className='text-xs font-semibold'>Heading *</Label>
        <Input
          value={block.heading}
          disabled={disabled}
          placeholder='Hero main headline'
          onChange={(e) => onChange({ heading: e.target.value })}
        />
      </div>
      <div className='space-y-1.5 md:col-span-2'>
        <Label className='text-xs font-semibold'>Subheading</Label>
        <Input
          value={block.subheading ?? ''}
          disabled={disabled}
          placeholder='Supporting subheadline text'
          onChange={(e) => onChange({ subheading: e.target.value })}
        />
      </div>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>CTA Button Text</Label>
        <Input
          value={block.ctaText ?? ''}
          disabled={disabled}
          placeholder='Get Started'
          onChange={(e) => onChange({ ctaText: e.target.value })}
        />
      </div>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>CTA Button URL</Label>
        <Input
          value={block.ctaUrl ?? ''}
          disabled={disabled}
          placeholder='https://... or /signup'
          onChange={(e) => onChange({ ctaUrl: e.target.value })}
        />
      </div>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>Background Image URL</Label>
        <Input
          value={block.backgroundImageUrl ?? ''}
          disabled={disabled}
          placeholder='https://images.unsplash.com/...'
          onChange={(e) => onChange({ backgroundImageUrl: e.target.value })}
        />
      </div>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>Alignment</Label>
        <Select
          value={block.alignment ?? 'center'}
          disabled={disabled}
          onValueChange={(val) => onChange({ alignment: val as 'left' | 'center' | 'right' })}
        >
          <SelectTrigger className='h-9 text-xs'>
            <SelectValue placeholder='Select alignment' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='left'>Left</SelectItem>
            <SelectItem value='center'>Center</SelectItem>
            <SelectItem value='right'>Right</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function FeaturesBlockEditor({
  block,
  disabled,
  onChange,
}: {
  block: FeaturesSectionBlock
  disabled?: boolean
  onChange: (patch: Partial<FeaturesSectionBlock>) => void
}) {
  const items = block.items || []

  const addItem = () => {
    onChange({
      items: [
        ...items,
        { title: 'New Feature', description: 'Feature description here', icon: 'sparkles' },
      ],
    })
  }

  const updateItem = (itemIndex: number, patch: Partial<(typeof items)[0]>) => {
    const next = [...items]
    const item = next[itemIndex]
    if (item) {
      next[itemIndex] = { ...item, ...patch }
      onChange({ items: next })
    }
  }

  const removeItem = (itemIndex: number) => {
    onChange({ items: items.filter((_, i) => i !== itemIndex) })
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 md:grid-cols-3 gap-3'>
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>Section Title</Label>
          <Input
            value={block.title ?? ''}
            disabled={disabled}
            placeholder='Features title'
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>Subtitle</Label>
          <Input
            value={block.subtitle ?? ''}
            disabled={disabled}
            placeholder='Subtitle or caption'
            onChange={(e) => onChange({ subtitle: e.target.value })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>Columns</Label>
          <Select
            value={String(block.columns ?? 3)}
            disabled={disabled}
            onValueChange={(val) => onChange({ columns: Number(val) })}
          >
            <SelectTrigger className='h-9 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='1'>1 Column</SelectItem>
              <SelectItem value='2'>2 Columns</SelectItem>
              <SelectItem value='3'>3 Columns</SelectItem>
              <SelectItem value='4'>4 Columns</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label className='text-xs font-semibold'>Feature Items ({items.length})</Label>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 text-xs gap-1'
            disabled={disabled}
            onClick={addItem}
          >
            <Plus className='size-3' />
            Add Feature
          </Button>
        </div>

        {items.map((item, itemIdx) => (
          <div
            key={itemIdx}
            className='p-3 border rounded-md bg-muted/20 space-y-2 relative'
          >
            <div className='flex items-center justify-between gap-2'>
              <Input
                value={item.title}
                disabled={disabled}
                placeholder='Feature title'
                className='h-8 text-xs font-medium'
                onChange={(e) => updateItem(itemIdx, { title: e.target.value })}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-7 text-destructive hover:bg-destructive/10 shrink-0'
                disabled={disabled}
                onClick={() => removeItem(itemIdx)}
                aria-label='Remove feature item'
              >
                <Trash2 className='size-3.5' />
              </Button>
            </div>
            <Textarea
              value={item.description}
              disabled={disabled}
              placeholder='Feature description'
              rows={2}
              className='text-xs'
              onChange={(e) => updateItem(itemIdx, { description: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function TextBlockEditor({
  block,
  disabled,
  onChange,
}: {
  block: TextBlockSectionBlock
  disabled?: boolean
  onChange: (patch: Partial<TextBlockSectionBlock>) => void
}) {
  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>Block Title</Label>
          <Input
            value={block.title ?? ''}
            disabled={disabled}
            placeholder='Optional block title'
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>Layout</Label>
          <Select
            value={block.layout ?? 'narrow'}
            disabled={disabled}
            onValueChange={(val) => onChange({ layout: val as 'full' | 'narrow' | 'two-column' })}
          >
            <SelectTrigger className='h-9 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='narrow'>Narrow / Centered</SelectItem>
              <SelectItem value='full'>Full Width</SelectItem>
              <SelectItem value='two-column'>Two Columns</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>Content *</Label>
        <Textarea
          value={block.content}
          disabled={disabled}
          placeholder='Write your content here...'
          rows={6}
          className='text-xs font-mono'
          onChange={(e) => onChange({ content: e.target.value })}
        />
      </div>
    </div>
  )
}

function ImageGalleryEditor({
  block,
  disabled,
  onChange,
}: {
  block: ImageGallerySectionBlock
  disabled?: boolean
  onChange: (patch: Partial<ImageGallerySectionBlock>) => void
}) {
  const images = block.images || []

  const addImage = () => {
    onChange({
      images: [
        ...images,
        { url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809', caption: '', alt: '' },
      ],
    })
  }

  const updateImage = (idx: number, patch: Partial<(typeof images)[0]>) => {
    const next = [...images]
    const img = next[idx]
    if (img) {
      next[idx] = { ...img, ...patch }
      onChange({ images: next })
    }
  }

  const removeImage = (idx: number) => {
    onChange({ images: images.filter((_, i) => i !== idx) })
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>Gallery Title</Label>
          <Input
            value={block.title ?? ''}
            disabled={disabled}
            placeholder='Gallery title'
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        <div className='space-y-1.5'>
          <Label className='text-xs font-semibold'>Layout</Label>
          <Select
            value={block.layout ?? 'grid'}
            disabled={disabled}
            onValueChange={(val) => onChange({ layout: val as 'grid' | 'carousel' | 'masonry' })}
          >
            <SelectTrigger className='h-9 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='grid'>Grid</SelectItem>
              <SelectItem value='carousel'>Carousel</SelectItem>
              <SelectItem value='masonry'>Masonry</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label className='text-xs font-semibold'>Images ({images.length})</Label>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 text-xs gap-1'
            disabled={disabled}
            onClick={addImage}
          >
            <Plus className='size-3' />
            Add Image
          </Button>
        </div>

        {images.map((img, idx) => (
          <div key={idx} className='p-3 border rounded-md bg-muted/20 space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <Input
                value={img.url}
                disabled={disabled}
                placeholder='Image URL *'
                className='h-8 text-xs'
                onChange={(e) => updateImage(idx, { url: e.target.value })}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-7 text-destructive hover:bg-destructive/10 shrink-0'
                disabled={disabled}
                onClick={() => removeImage(idx)}
                aria-label='Remove gallery image'
              >
                <Trash2 className='size-3.5' />
              </Button>
            </div>
            <div className='grid grid-cols-2 gap-2'>
              <Input
                value={img.caption ?? ''}
                disabled={disabled}
                placeholder='Caption (optional)'
                className='h-7 text-xs'
                onChange={(e) => updateImage(idx, { caption: e.target.value })}
              />
              <Input
                value={img.alt ?? ''}
                disabled={disabled}
                placeholder='Alt text (accessibility)'
                className='h-7 text-xs'
                onChange={(e) => updateImage(idx, { alt: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CallToActionEditor({
  block,
  disabled,
  onChange,
}: {
  block: CallToActionSectionBlock
  disabled?: boolean
  onChange: (patch: Partial<CallToActionSectionBlock>) => void
}) {
  return (
    <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
      <div className='space-y-1.5 md:col-span-2'>
        <Label className='text-xs font-semibold'>Heading *</Label>
        <Input
          value={block.heading}
          disabled={disabled}
          placeholder='Ready to scale?'
          onChange={(e) => onChange({ heading: e.target.value })}
        />
      </div>
      <div className='space-y-1.5 md:col-span-2'>
        <Label className='text-xs font-semibold'>Description</Label>
        <Textarea
          value={block.description ?? ''}
          disabled={disabled}
          placeholder='Call to action body description...'
          rows={2}
          className='text-xs'
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>Button Text *</Label>
        <Input
          value={block.buttonText}
          disabled={disabled}
          placeholder='Start Free Trial'
          onChange={(e) => onChange({ buttonText: e.target.value })}
        />
      </div>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>Button URL *</Label>
        <Input
          value={block.buttonUrl}
          disabled={disabled}
          placeholder='/pricing'
          onChange={(e) => onChange({ buttonUrl: e.target.value })}
        />
      </div>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>Style</Label>
        <Select
          value={block.style ?? 'primary'}
          disabled={disabled}
          onValueChange={(val) => onChange({ style: val as 'primary' | 'secondary' | 'outline' | 'dark' })}
        >
          <SelectTrigger className='h-9 text-xs'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='primary'>Primary</SelectItem>
            <SelectItem value='secondary'>Secondary</SelectItem>
            <SelectItem value='outline'>Outline</SelectItem>
            <SelectItem value='dark'>Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function FaqBlockEditor({
  block,
  disabled,
  onChange,
}: {
  block: FaqSectionBlock
  disabled?: boolean
  onChange: (patch: Partial<FaqSectionBlock>) => void
}) {
  const items = block.items || []

  const addItem = () => {
    onChange({
      items: [
        ...items,
        { question: 'What is the question?', answer: 'Answer to the question goes here.' },
      ],
    })
  }

  const updateItem = (idx: number, patch: Partial<(typeof items)[0]>) => {
    const next = [...items]
    const item = next[idx]
    if (item) {
      next[idx] = { ...item, ...patch }
      onChange({ items: next })
    }
  }

  const removeItem = (idx: number) => {
    onChange({ items: items.filter((_, i) => i !== idx) })
  }

  return (
    <div className='space-y-3'>
      <div className='space-y-1.5'>
        <Label className='text-xs font-semibold'>FAQ Section Title</Label>
        <Input
          value={block.title ?? ''}
          disabled={disabled}
          placeholder='Frequently Asked Questions'
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>

      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <Label className='text-xs font-semibold'>Questions ({items.length})</Label>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 text-xs gap-1'
            disabled={disabled}
            onClick={addItem}
          >
            <Plus className='size-3' />
            Add Question
          </Button>
        </div>

        {items.map((item, idx) => (
          <div key={idx} className='p-3 border rounded-md bg-muted/20 space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <Input
                value={item.question}
                disabled={disabled}
                placeholder='Question *'
                className='h-8 text-xs font-medium'
                onChange={(e) => updateItem(idx, { question: e.target.value })}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-7 text-destructive hover:bg-destructive/10 shrink-0'
                disabled={disabled}
                onClick={() => removeItem(idx)}
                aria-label='Remove question'
              >
                <Trash2 className='size-3.5' />
              </Button>
            </div>
            <Textarea
              value={item.answer}
              disabled={disabled}
              placeholder='Answer *'
              rows={2}
              className='text-xs'
              onChange={(e) => updateItem(idx, { answer: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
