/**
 * Microsoft Entra ID (Azure AD) OIDC config for Better Auth `microsoft` provider.
 *
 * Used by both Cloudflare Workers (`createAuthForEnv`) and the OSS hosting path
 * (`loadHostingConfig` passthrough → same Env keys).
 */

export type EntraTenantKind = 'directory' | 'common' | 'organizations' | 'consumers' | 'custom'

export type EntraAuthConfig = {
  enabled: boolean
  clientId?: string
  clientSecret?: string
  /**
   * Directory GUID, or `common` / `organizations` / `consumers`.
   * Defaults to `common` when client credentials are set but tenant is unset.
   */
  tenantId: string
  tenantKind: EntraTenantKind
  /**
   * Reply URL to register on the Entra app (must match Better Auth callback).
   * Override with `ENTRA_REDIRECT_URI` only when it equals the computed URL
   * under your public `BASE_URL` (ops checklist / External Secrets echo).
   */
  redirectUri: string
  /**
   * How the confidential client authenticates to Entra's token endpoint.
   * Better Auth's microsoft provider expects a client secret today.
   * Federated/workload credentials are documented as ops alternatives that
   * still inject a secret (or stop-gap) into `ENTRA_CLIENT_SECRET`.
   */
  clientAuth: 'client_secret' | 'unset'
}

const DIRECTORY_GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WELL_KNOWN_TENANTS = new Set(['common', 'organizations', 'consumers'])

export function classifyEntraTenantId(raw: string | undefined): {
  tenantId: string
  tenantKind: EntraTenantKind
} {
  const trimmed = raw?.trim() || 'common'
  const lower = trimmed.toLowerCase()
  if (DIRECTORY_GUID.test(trimmed)) {
    return { tenantId: trimmed, tenantKind: 'directory' }
  }
  if (WELL_KNOWN_TENANTS.has(lower)) {
    return { tenantId: lower, tenantKind: lower as EntraTenantKind }
  }
  return { tenantId: trimmed, tenantKind: 'custom' }
}

/** Canonical Better Auth Microsoft callback path. */
export function buildEntraRedirectUri(baseURL: string): string {
  const base = baseURL.replace(/\/$/, '')
  return `${base}/api/auth/callback/microsoft`
}

export type ResolveEntraAuthInput = {
  baseURL: string
  ENTRA_CLIENT_ID?: string
  ENTRA_CLIENT_SECRET?: string
  ENTRA_TENANT_ID?: string
  /**
   * Optional ops echo of the reply URL. When set and mismatched with the
   * URI derived from `baseURL`, resolution throws so misconfigured proxies
   * fail closed at boot rather than at first login.
   */
  ENTRA_REDIRECT_URI?: string
}

/**
 * Resolve Entra OIDC settings from env. Disabled (no microsoft social
 * provider) when client id or secret is missing.
 */
export function resolveEntraAuthConfig(input: ResolveEntraAuthInput): EntraAuthConfig {
  const clientId = input.ENTRA_CLIENT_ID?.trim() || undefined
  const clientSecret = input.ENTRA_CLIENT_SECRET?.trim() || undefined
  const { tenantId, tenantKind } = classifyEntraTenantId(input.ENTRA_TENANT_ID)
  const redirectUri = buildEntraRedirectUri(input.baseURL)

  const override = input.ENTRA_REDIRECT_URI?.trim()
  if (override && override !== redirectUri) {
    throw new Error(
      `ENTRA_REDIRECT_URI (${override}) must match ${redirectUri} (derived from BASE_URL). ` +
        'Register that reply URL on the Entra app registration; do not invent a different path.'
    )
  }

  const enabled = Boolean(clientId && clientSecret)
  return {
    enabled,
    clientId,
    clientSecret,
    tenantId,
    tenantKind,
    redirectUri: override || redirectUri,
    clientAuth: enabled ? 'client_secret' : 'unset',
  }
}

/** Shape Better Auth expects under `socialProviders.microsoft`. */
export function toBetterAuthMicrosoftProvider(config: EntraAuthConfig):
  | {
      clientId: string
      clientSecret: string
      tenantId: string
    }
  | undefined {
  if (!config.enabled || !config.clientId || !config.clientSecret) return undefined
  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tenantId: config.tenantId,
  }
}
