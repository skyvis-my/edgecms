import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Repo root from `apps/api/src/tests/hosting`. */
const REPO_ROOT = join(import.meta.dir, '../../../../../')

describe('Docker Compose Entra wiring', () => {
  it('forwards ENTRA_* into the API service environment', () => {
    const compose = readFileSync(
      join(REPO_ROOT, 'deploy/docker/docker-compose.yml'),
      'utf8'
    )
    expect(compose).toContain('ENTRA_CLIENT_ID:')
    expect(compose).toContain('ENTRA_CLIENT_SECRET:')
    expect(compose).toContain('ENTRA_TENANT_ID:')
    expect(compose).toContain('ENTRA_REDIRECT_URI:')
    expect(compose).toContain('SSO_MODE:')
  })

  it('documents Entra keys in the docker .env.example', () => {
    const example = readFileSync(
      join(REPO_ROOT, 'deploy/docker/.env.example'),
      'utf8'
    )
    expect(example).toContain('ENTRA_CLIENT_ID=')
    expect(example).toContain('api/auth/callback/microsoft')
  })
})
