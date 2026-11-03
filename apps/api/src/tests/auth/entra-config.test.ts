import { describe, expect, it } from 'bun:test'
import {
  buildEntraRedirectUri,
  classifyEntraTenantId,
  resolveEntraAuthConfig,
  toBetterAuthMicrosoftProvider,
} from '../../auth/entra-auth'

describe('Entra auth config', () => {
  it('builds the Better Auth microsoft callback reply URL', () => {
    expect(buildEntraRedirectUri('https://cms.example.com/')).toBe(
      'https://cms.example.com/api/auth/callback/microsoft'
    )
  })

  it('classifies directory GUID vs multi-tenant federation aliases', () => {
    expect(classifyEntraTenantId('11111111-1111-1111-1111-111111111111')).toEqual({
      tenantId: '11111111-1111-1111-1111-111111111111',
      tenantKind: 'directory',
    })
    expect(classifyEntraTenantId('Organizations')).toEqual({
      tenantId: 'organizations',
      tenantKind: 'organizations',
    })
    expect(classifyEntraTenantId(undefined)).toEqual({
      tenantId: 'common',
      tenantKind: 'common',
    })
  })

  it('enables microsoft provider only with client id + secret', () => {
    const disabled = resolveEntraAuthConfig({
      baseURL: 'https://cms.example.com',
      ENTRA_CLIENT_ID: 'id-only',
    })
    expect(disabled.enabled).toBe(false)
    expect(toBetterAuthMicrosoftProvider(disabled)).toBeUndefined()

    const enabled = resolveEntraAuthConfig({
      baseURL: 'https://cms.example.com',
      ENTRA_CLIENT_ID: 'entra-client-id',
      ENTRA_CLIENT_SECRET: 'entra-client-secret',
      ENTRA_TENANT_ID: 'organizations',
    })
    expect(enabled).toMatchObject({
      enabled: true,
      clientAuth: 'client_secret',
      tenantId: 'organizations',
      tenantKind: 'organizations',
      redirectUri: 'https://cms.example.com/api/auth/callback/microsoft',
    })
    expect(toBetterAuthMicrosoftProvider(enabled)).toEqual({
      clientId: 'entra-client-id',
      clientSecret: 'entra-client-secret',
      tenantId: 'organizations',
    })
  })

  it('fails closed when ENTRA_REDIRECT_URI mismatches BASE_URL-derived reply URL', () => {
    expect(() =>
      resolveEntraAuthConfig({
        baseURL: 'https://cms.example.com',
        ENTRA_CLIENT_ID: 'id',
        ENTRA_CLIENT_SECRET: 'secret',
        ENTRA_REDIRECT_URI: 'https://wrong.example/callback',
      })
    ).toThrow(/ENTRA_REDIRECT_URI/)
  })

  it('accepts matching ENTRA_REDIRECT_URI echo', () => {
    const cfg = resolveEntraAuthConfig({
      baseURL: 'https://cms.example.com',
      ENTRA_CLIENT_ID: 'id',
      ENTRA_CLIENT_SECRET: 'secret',
      ENTRA_REDIRECT_URI: 'https://cms.example.com/api/auth/callback/microsoft',
    })
    expect(cfg.redirectUri).toBe('https://cms.example.com/api/auth/callback/microsoft')
  })
})
