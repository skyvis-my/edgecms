import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFilesystemR2 } from '@/hosting/bindings/filesystem-r2'

describe('createFilesystemR2', () => {
  it('puts, gets, and deletes objects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'edgecms-r2-'))
    try {
      const r2 = createFilesystemR2(root)
      const bytes = new TextEncoder().encode('hello')
      await r2.put('tenants/a/file.txt', bytes, {
        httpMetadata: { contentType: 'text/plain' },
      })
      const obj = await r2.get('tenants/a/file.txt')
      expect(obj).not.toBeNull()
      expect(await obj!.text()).toBe('hello')
      expect(obj!.httpMetadata?.contentType).toBe('text/plain')
      await r2.delete('tenants/a/file.txt')
      expect(await r2.get('tenants/a/file.txt')).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
