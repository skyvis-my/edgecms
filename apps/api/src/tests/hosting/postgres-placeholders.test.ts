import { describe, expect, it } from 'bun:test'
import { sqlitePlaceholdersToPostgres } from '@/hosting/bindings/postgres-d1'

describe('sqlitePlaceholdersToPostgres', () => {
  it('rewrites ? placeholders to $n', () => {
    expect(sqlitePlaceholdersToPostgres('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2'
    )
  })

  it('leaves SQL without placeholders unchanged', () => {
    expect(sqlitePlaceholdersToPostgres('SELECT 1')).toBe('SELECT 1')
  })
})
