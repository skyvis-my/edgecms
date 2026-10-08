import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_ASSET_ALLOWED_MIME_TYPES,
  isAllowedAssetMimeType,
  resolveAssetMimeType,
} from '../../assets/file-policy'

describe('asset file policy', () => {
  it('infers and allows YAML uploads from extension fallback', () => {
    const mimeType = resolveAssetMimeType('content/menu.yml', 'application/octet-stream')

    expect(mimeType).toBe('text/yaml')
    expect(isAllowedAssetMimeType(mimeType, DEFAULT_ASSET_ALLOWED_MIME_TYPES)).toBe(true)
  })
})
