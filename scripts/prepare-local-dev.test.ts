import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultDevVars,
  ensureAdminDist,
  ensureDevVars,
  LOCAL_SUPER_ADMIN_EMAIL,
  parseDevVarKeys,
} from './prepare-local-dev'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edgecms-prepare-dev-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('prepare-local-dev', () => {
  it('generates 32-byte secrets and the smoke admin as super admin', () => {
    const vars = defaultDevVars()
    expect(vars.BETTER_AUTH_SECRET).toMatch(/^[0-9a-f]{64}$/)
    expect(vars.JWT_HS256_SECRET).toMatch(/^[0-9a-f]{64}$/)
    expect(vars.BETTER_AUTH_SECRET).not.toBe(vars.JWT_HS256_SECRET)
    expect(vars.SUPER_ADMIN_EMAILS).toBe(LOCAL_SUPER_ADMIN_EMAIL)
  })

  it('creates .dev.vars when missing', async () => {
    const path = join(dir, '.dev.vars')
    const added = await ensureDevVars(path, { A: '1', B: '2' })
    expect(added).toEqual(['A', 'B'])
    expect(parseDevVarKeys(await readFile(path, 'utf8'))).toEqual(new Set(['A', 'B']))
  })

  it('only appends missing keys and keeps existing values', async () => {
    const path = join(dir, '.dev.vars')
    await writeFile(path, '# mine\nA=keep')
    const added = await ensureDevVars(path, { A: 'replace', B: '2' })
    expect(added).toEqual(['B'])
    expect(await readFile(path, 'utf8')).toBe('# mine\nA=keep\nB=2\n')
    expect(await ensureDevVars(path, { A: 'x', B: 'y' })).toEqual([])
  })

  it('creates a placeholder admin build only when none exists', async () => {
    const dist = join(dir, 'dist')
    expect(await ensureAdminDist(dist)).toBe(true)
    expect(await readFile(join(dist, 'index.html'), 'utf8')).toContain('localhost:5173')
    expect(await ensureAdminDist(dist)).toBe(false)
  })
})
