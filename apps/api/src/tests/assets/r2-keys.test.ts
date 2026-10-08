import { describe, expect, it } from 'bun:test'
import { buildOriginalKey, buildVariantKey } from '../../assets/r2-keys'

describe('r2-keys', () => {
  describe('buildOriginalKey', () => {
    it('builds a key without tenant prefix when tenantId is undefined', () => {
      const key = buildOriginalKey(undefined, 'asset-123', 'photo.png')
      expect(key).toBe('assets/asset-123/original/photo.png')
    })

    it('builds a key with tenant prefix when tenantId is provided', () => {
      const key = buildOriginalKey('tenant-abc', 'asset-123', 'photo.png')
      expect(key).toBe('tenants/tenant-abc/assets/asset-123/original/photo.png')
    })

    it('sanitizes unsafe characters in filename', () => {
      const key = buildOriginalKey(undefined, 'asset-1', 'my photo (1).png')
      expect(key).toBe('assets/asset-1/original/my-photo--1-.png')
    })

    it('preserves dots, hyphens, and underscores in filename', () => {
      const key = buildOriginalKey(undefined, 'asset-1', 'my_file-v2.0.tar.gz')
      expect(key).toBe('assets/asset-1/original/my_file-v2.0.tar.gz')
    })

    it('replaces all non-alphanumeric/dot/hyphen/underscore chars', () => {
      const key = buildOriginalKey(undefined, 'asset-1', 'file@#$%^&.jpg')
      expect(key).toBe('assets/asset-1/original/file------.jpg')
    })

    it('handles filename with only special characters before extension', () => {
      const key = buildOriginalKey(undefined, 'asset-1', '!!!.png')
      expect(key).toBe('assets/asset-1/original/---.png')
    })

    it('builds tenant-scoped key with sanitized filename', () => {
      const key = buildOriginalKey('t1', 'a1', 'Hello World!.jpeg')
      expect(key).toBe('tenants/t1/assets/a1/original/Hello-World-.jpeg')
    })
  })

  describe('buildVariantKey', () => {
    it('builds a variant key without tenant prefix when tenantId is undefined', () => {
      const key = buildVariantKey(undefined, 'asset-123', 'md', 'webp')
      expect(key).toBe('assets/asset-123/variants/md.webp')
    })

    it('builds a variant key with tenant prefix when tenantId is provided', () => {
      const key = buildVariantKey('tenant-abc', 'asset-123', 'md', 'webp')
      expect(key).toBe('tenants/tenant-abc/assets/asset-123/variants/md.webp')
    })

    it('builds key with different variant names', () => {
      expect(buildVariantKey(undefined, 'a1', 'sm', 'avif')).toBe(
        'assets/a1/variants/sm.avif'
      )
      expect(buildVariantKey(undefined, 'a1', 'lg', 'png')).toBe(
        'assets/a1/variants/lg.png'
      )
      expect(buildVariantKey(undefined, 'a1', 'thumbnail', 'jpg')).toBe(
        'assets/a1/variants/thumbnail.jpg'
      )
    })

    it('builds key with different format extensions', () => {
      expect(buildVariantKey(undefined, 'a1', 'md', 'webp')).toBe(
        'assets/a1/variants/md.webp'
      )
      expect(buildVariantKey(undefined, 'a1', 'md', 'avif')).toBe(
        'assets/a1/variants/md.avif'
      )
      expect(buildVariantKey(undefined, 'a1', 'md', 'jpeg')).toBe(
        'assets/a1/variants/md.jpeg'
      )
    })

    it('scopes to tenant correctly with various variant/format combos', () => {
      const key = buildVariantKey('t-99', 'asset-42', 'hero', 'avif')
      expect(key).toBe('tenants/t-99/assets/asset-42/variants/hero.avif')
    })
  })
})
