import { Type, createSchema } from './typebox'

export const supportedSectionBlockTypes = [
  'hero',
  'features',
  'textBlock',
  'imageGallery',
  'callToAction',
  'faq',
] as const

export const sectionBlockType = createSchema(
  Type.Union([
    Type.Literal('hero'),
    Type.Literal('features'),
    Type.Literal('textBlock'),
    Type.Literal('imageGallery'),
    Type.Literal('callToAction'),
    Type.Literal('faq'),
  ])
)

export type SectionBlockType = typeof sectionBlockType.infer

// 1. Hero Section Block
export const heroSectionBlock = createSchema(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    type: Type.Literal('hero'),
    heading: Type.String({ minLength: 1 }),
    subheading: Type.Optional(Type.String()),
    ctaText: Type.Optional(Type.String()),
    ctaUrl: Type.Optional(Type.String()),
    backgroundImageUrl: Type.Optional(Type.String()),
    alignment: Type.Optional(
      Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')])
    ),
  })
)
export type HeroSectionBlock = typeof heroSectionBlock.infer

// 2. Features Section Block
export const featureItem = createSchema(
  Type.Object({
    title: Type.String({ minLength: 1 }),
    description: Type.String(),
    icon: Type.Optional(Type.String()),
    link: Type.Optional(Type.String()),
  })
)
export type FeatureItem = typeof featureItem.infer

export const featuresSectionBlock = createSchema(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    type: Type.Literal('features'),
    title: Type.Optional(Type.String()),
    subtitle: Type.Optional(Type.String()),
    items: Type.Array(featureItem),
    columns: Type.Optional(Type.Integer({ minimum: 1 })),
  })
)
export type FeaturesSectionBlock = typeof featuresSectionBlock.infer

// 3. TextBlock Section Block
export const textBlockSectionBlock = createSchema(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    type: Type.Literal('textBlock'),
    title: Type.Optional(Type.String()),
    content: Type.String(),
    layout: Type.Optional(
      Type.Union([Type.Literal('full'), Type.Literal('narrow'), Type.Literal('two-column')])
    ),
  })
)
export type TextBlockSectionBlock = typeof textBlockSectionBlock.infer

// 4. ImageGallery Section Block
export const galleryImageItem = createSchema(
  Type.Object({
    url: Type.String({ minLength: 1 }),
    caption: Type.Optional(Type.String()),
    alt: Type.Optional(Type.String()),
  })
)
export type GalleryImageItem = typeof galleryImageItem.infer

export const imageGallerySectionBlock = createSchema(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    type: Type.Literal('imageGallery'),
    title: Type.Optional(Type.String()),
    images: Type.Array(galleryImageItem),
    layout: Type.Optional(
      Type.Union([Type.Literal('grid'), Type.Literal('carousel'), Type.Literal('masonry')])
    ),
  })
)
export type ImageGallerySectionBlock = typeof imageGallerySectionBlock.infer

// 5. CallToAction Section Block
export const callToActionSectionBlock = createSchema(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    type: Type.Literal('callToAction'),
    heading: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    buttonText: Type.String({ minLength: 1 }),
    buttonUrl: Type.String({ minLength: 1 }),
    style: Type.Optional(
      Type.Union([
        Type.Literal('primary'),
        Type.Literal('secondary'),
        Type.Literal('outline'),
        Type.Literal('dark'),
      ])
    ),
  })
)
export type CallToActionSectionBlock = typeof callToActionSectionBlock.infer

// 6. FAQ Section Block
export const faqItem = createSchema(
  Type.Object({
    question: Type.String({ minLength: 1 }),
    answer: Type.String({ minLength: 1 }),
  })
)
export type FaqItem = typeof faqItem.infer

export const faqSectionBlock = createSchema(
  Type.Object({
    id: Type.String({ minLength: 1 }),
    type: Type.Literal('faq'),
    title: Type.Optional(Type.String()),
    items: Type.Array(faqItem),
  })
)
export type FaqSectionBlock = typeof faqSectionBlock.infer

// Polymorphic section block union
export const sectionBlock = createSchema(
  Type.Union([
    heroSectionBlock,
    featuresSectionBlock,
    textBlockSectionBlock,
    imageGallerySectionBlock,
    callToActionSectionBlock,
    faqSectionBlock,
  ])
)

export type SectionBlock = typeof sectionBlock.infer

export const sectionBlocksList = createSchema(Type.Array(sectionBlock))
export type SectionBlocksList = typeof sectionBlocksList.infer

/**
 * Creates an empty default section block instance for interactive UI editors.
 */
export function createDefaultSectionBlock(
  blockType: SectionBlockType,
  id: string = `sec_${Math.random().toString(36).substring(2, 9)}`
): SectionBlock {
  switch (blockType) {
    case 'hero':
      return {
        id,
        type: 'hero',
        heading: 'New Hero Section',
        subheading: 'Enter your compelling subheading here',
        ctaText: 'Get Started',
        ctaUrl: '#',
        alignment: 'center',
      }
    case 'features':
      return {
        id,
        type: 'features',
        title: 'Core Features',
        subtitle: 'Everything you need to scale',
        columns: 3,
        items: [
          { title: 'Lightning Fast', description: 'Runs at Cloudflare Edge with 0ms cold starts.' },
          { title: 'Type Safe', description: 'End-to-end contracts and runtime schema validation.' },
          { title: 'Autonomous AI', description: 'Self-improving content ops with strict safety gates.' },
        ],
      }
    case 'textBlock':
      return {
        id,
        type: 'textBlock',
        title: 'About This Section',
        content: 'Write your longform editorial content or story here.',
        layout: 'narrow',
      }
    case 'imageGallery':
      return {
        id,
        type: 'imageGallery',
        title: 'Gallery Highlights',
        layout: 'grid',
        images: [
          { url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809', alt: 'Sample 1', caption: 'Vibrant Colors' },
          { url: 'https://images.unsplash.com/photo-1557683316-973673baf926', alt: 'Sample 2', caption: 'Smooth Gradient' },
        ],
      }
    case 'callToAction':
      return {
        id,
        type: 'callToAction',
        heading: 'Ready to build with EdgeCMS?',
        description: 'Start managing your edge content in minutes.',
        buttonText: 'Deploy Now',
        buttonUrl: '/docs/getting-started',
        style: 'primary',
      }
    case 'faq':
      return {
        id,
        type: 'faq',
        title: 'Frequently Asked Questions',
        items: [
          { question: 'What is EdgeCMS?', answer: 'EdgeCMS is a modern content management system architected for edge runtimes.' },
          { question: 'Does it support live preview?', answer: 'Yes! Instant split-pane streaming preview with zero database persistence overhead.' },
        ],
      }
  }
}

/**
 * Validates a single section block using TypeBox.
 */
export function validateSectionBlock(data: unknown): {
  success: boolean
  data?: SectionBlock
  error?: string
} {
  const result = sectionBlock(data)
  if ('issues' in result) {
    return { success: false, error: result.issues.map((i: any) => i.message).join('; ') }
  }
  return { success: true, data: result as SectionBlock }
}

/**
 * Validates a list of section blocks using TypeBox.
 */
export function validateSectionBlocks(data: unknown): {
  success: boolean
  data?: SectionBlock[]
  error?: string
} {
  const result = sectionBlocksList(data)
  if ('issues' in result) {
    return { success: false, error: result.issues.map((i: any) => i.message).join('; ') }
  }
  return { success: true, data: result as SectionBlock[] }
}
