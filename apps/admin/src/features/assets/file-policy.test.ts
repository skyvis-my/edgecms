import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_ASSET_ALLOWED_MIME_TYPES,
  isFileAllowedForUpload,
  resolveFileMimeType,
} from './file-policy'

describe('asset file policy', () => {
  it('infers and allows YAML uploads from extension fallback', () => {
    const file = new File(['title: Menu'], 'content/menu.yaml', {
      type: 'application/octet-stream',
    })

    expect(resolveFileMimeType(file)).toBe('text/yaml')
    expect(isFileAllowedForUpload(file, DEFAULT_ASSET_ALLOWED_MIME_TYPES)).toBe(true)
  })
})
