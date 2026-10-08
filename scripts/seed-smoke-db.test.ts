import { describe, expect, it } from 'bun:test'
import { buildSeedSql, parseSeedOptions } from './seed-smoke-db'

describe('seed-smoke-db options', () => {
  it('defaults to local smoke seed values', () => {
    expect(parseSeedOptions([], {})).toEqual({
      env: 'local',
      remote: false,
      allowProduction: false,
      email: 'smoke.admin@example.com',
      password: 'SmokePassw0rd!',
      tenantSlug: 'smoke',
      tenantName: 'Smoke Tenant',
      collectionSlug: 'smoke-posts',
      collectionName: 'Smoke Posts',
    })
  })

  it('treats staging as remote and accepts explicit seed values', () => {
    expect(
      parseSeedOptions([
        '--env',
        'staging',
        '--email=admin@example.test',
        '--tenant-slug',
        'pilot',
        '--collection-slug',
        'articles',
      ])
    ).toMatchObject({
      env: 'staging',
      remote: true,
      email: 'admin@example.test',
      tenantSlug: 'pilot',
      collectionSlug: 'articles',
    })
  })

  it('rejects unsupported environments', () => {
    expect(() => parseSeedOptions(['--env', 'preview'], {})).toThrow('Unsupported seed env: preview')
  })
})

describe('seed-smoke-db SQL', () => {
  it('seeds auth, tenant membership, and smoke collection', () => {
    const options = parseSeedOptions([], {})
    const sql = buildSeedSql(options, 'hash:value', new Date('2026-06-04T00:00:00.000Z'))

    expect(sql).toContain('INSERT INTO "user"')
    expect(sql).toContain('INSERT INTO "account"')
    expect(sql).toContain('INSERT INTO "tenants"')
    expect(sql).toContain('INSERT INTO "tenant_users"')
    expect(sql).toContain('INSERT INTO "collections"')
    expect(sql).toContain("'credential'")
    expect(sql).toContain("'owner'")
    expect(sql).toContain("'smoke-posts'")
  })

  it('keeps smoke seed idempotent with conflict-safe writes', () => {
    const options = parseSeedOptions([], {})
    const sql = buildSeedSql(options, 'hash:value', new Date('2026-06-04T00:00:00.000Z'))

    expect(sql.match(/ON CONFLICT/g)).toHaveLength(5)
    expect(sql).toContain('ON CONFLICT("id") DO UPDATE SET')
    expect(sql).toContain('ON CONFLICT("slug") DO UPDATE SET')
    expect(sql).toContain('ON CONFLICT("tenantId", "userId") DO UPDATE SET')
    expect(sql).toContain('ON CONFLICT("tenantId", "slug") DO UPDATE SET')
    expect(sql).not.toContain('INSERT OR IGNORE')
  })

  it('uses stable smoke identities across repeated local seed builds', () => {
    const options = parseSeedOptions([], {})
    const firstRun = buildSeedSql(options, 'hash:value', new Date('2026-06-04T00:00:00.000Z'))
    const secondRun = buildSeedSql(options, 'hash:value', new Date('2026-06-04T00:00:00.000Z'))

    expect(secondRun).toBe(firstRun)
    expect(firstRun).toContain("'smoke-user'")
    expect(firstRun).toContain("'smoke-tenant'")
    expect(firstRun).toContain("'smoke-collection-posts'")
  })

  it('escapes SQL string values', () => {
    const options = {
      ...parseSeedOptions([], {}),
      tenantName: "Smoke's Tenant",
    }
    const sql = buildSeedSql(options, 'hash:value', new Date('2026-06-04T00:00:00.000Z'))

    expect(sql).toContain("Smoke''s Tenant")
  })
})
