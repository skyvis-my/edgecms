import { describe, expect, it } from 'bun:test'
import {
  createDefaultSectionBlock,
  heroSectionBlock,
  featuresSectionBlock,
  textBlockSectionBlock,
  imageGallerySectionBlock,
  callToActionSectionBlock,
  faqSectionBlock,
  sectionBlock,
  sectionBlocksList,
  supportedSectionBlockTypes,
  validateSectionBlock,
  validateSectionBlocks,
} from '../block-sections'

describe('@edgecms/schemas block-sections', () => {
  it('defines the 6 supported section block types', () => {
    expect(supportedSectionBlockTypes).toEqual([
      'hero',
      'features',
      'textBlock',
      'imageGallery',
      'callToAction',
      'faq',
    ])
  })

  it('validates a valid Hero section block', () => {
    const hero = {
      id: 'sec-1',
      type: 'hero' as const,
      heading: 'Welcome to EdgeCMS',
      subheading: 'Edge-native CMS for modern applications',
      ctaText: 'Explore Docs',
      ctaUrl: 'https://edgecms.dev/docs',
      alignment: 'center' as const,
    }

    const res = heroSectionBlock(hero)
    expect(res).toMatchObject(hero)

    const unionRes = sectionBlock(hero)
    expect(unionRes).toMatchObject(hero)
  })

  it('validates a valid Features section block', () => {
    const features = {
      id: 'sec-2',
      type: 'features' as const,
      title: 'Built for Performance',
      subtitle: 'Zero latency anywhere',
      columns: 3,
      items: [
        { title: 'Global KV', description: 'Cached globally' },
        { title: 'D1 Storage', description: 'SQLite database' },
      ],
    }

    const res = featuresSectionBlock(features)
    expect(res).toMatchObject(features)
    expect(validateSectionBlock(features).success).toBe(true)
  })

  it('validates a valid TextBlock section block', () => {
    const textBlock = {
      id: 'sec-3',
      type: 'textBlock' as const,
      title: 'Our Mission',
      content: 'We empower developers to build blazing fast web experiences.',
      layout: 'narrow' as const,
    }

    const res = textBlockSectionBlock(textBlock)
    expect(res).toMatchObject(textBlock)
    expect(validateSectionBlock(textBlock).success).toBe(true)
  })

  it('validates a valid ImageGallery section block', () => {
    const gallery = {
      id: 'sec-4',
      type: 'imageGallery' as const,
      title: 'Product Snapshots',
      layout: 'grid' as const,
      images: [
        { url: 'https://example.com/1.jpg', caption: 'Dashboard', alt: 'Admin interface' },
        { url: 'https://example.com/2.jpg' },
      ],
    }

    const res = imageGallerySectionBlock(gallery)
    expect(res).toMatchObject(gallery)
    expect(validateSectionBlock(gallery).success).toBe(true)
  })

  it('validates a valid CallToAction section block', () => {
    const cta = {
      id: 'sec-5',
      type: 'callToAction' as const,
      heading: 'Ready to try it?',
      description: 'Sign up today and get started.',
      buttonText: 'Get Started',
      buttonUrl: '/signup',
      style: 'primary' as const,
    }

    const res = callToActionSectionBlock(cta)
    expect(res).toMatchObject(cta)
    expect(validateSectionBlock(cta).success).toBe(true)
  })

  it('validates a valid FAQ section block', () => {
    const faq = {
      id: 'sec-6',
      type: 'faq' as const,
      title: 'Frequently Asked Questions',
      items: [
        { question: 'Is it free?', answer: 'Yes, it is open source under MIT.' },
      ],
    }

    const res = faqSectionBlock(faq)
    expect(res).toMatchObject(faq)
    expect(validateSectionBlock(faq).success).toBe(true)
  })

  it('validates a polymorphic list of multiple section blocks', () => {
    const blocks = supportedSectionBlockTypes.map((type, i) =>
      createDefaultSectionBlock(type, `sec-${i}`)
    )

    const listRes = sectionBlocksList(blocks)
    expect(Array.isArray(listRes)).toBe(true)
    expect(listRes).toHaveLength(6)

    const validateRes = validateSectionBlocks(blocks)
    expect(validateRes.success).toBe(true)
    expect(validateRes.data).toHaveLength(6)
  })

  it('rejects blocks with invalid or missing required properties', () => {
    const invalidHero = {
      id: 'sec-bad',
      type: 'hero',
      // missing required heading
    }

    const res = validateSectionBlock(invalidHero)
    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()

    const unknownTypeBlock = {
      id: 'sec-bad',
      type: 'unsupportedType',
    }
    const unknownRes = validateSectionBlock(unknownTypeBlock)
    expect(unknownRes.success).toBe(false)
  })
})
