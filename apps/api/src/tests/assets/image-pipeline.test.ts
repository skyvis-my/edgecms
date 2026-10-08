import { describe, expect, it } from 'bun:test'
import { imagePipeline } from '../../assets/image-pipeline'

describe('imagePipeline', () => {
  it('plans 4 PRD variants and supports modern formats', () => {
    const planned = imagePipeline.planVariants({
      assetId: 'a1',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      width: 3200,
      height: 1600,
    })

    const variantNames = [...new Set(planned.map((v) => v.variant))]
    expect(variantNames).toEqual(['original', 'thumbnail', 'small', 'medium', 'large'])
    expect(planned.some((v) => v.format === 'avif')).toBe(true)
    expect(planned.some((v) => v.format === 'webp')).toBe(true)
  })
})
