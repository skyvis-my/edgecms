import { edenDelete, edenGet, edenPostForTenant, edenPut } from './eden-client'

export type ApiClient = {
  defaults: {
    headers: Record<string, string>
  }
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body?: unknown) => Promise<T>
  put: <T>(path: string, body?: unknown) => Promise<T>
  delete: <T = void>(path: string) => Promise<T>
}

export function createApiClient(options: { tenantSlug: string | null }): ApiClient {
  const headers: Record<string, string> = {}
  if (options.tenantSlug) {
    headers['x-tenant'] = options.tenantSlug
  }

  return {
    defaults: {
      headers,
    },
    get: <T>(path: string) => edenGet<T>(path),
    post: <T>(path: string, body?: unknown) =>
      edenPostForTenant<T>(path, body ?? {}, options.tenantSlug),
    put: <T>(path: string, body?: unknown) => edenPut<T>(path, body),
    delete: <T = void>(path: string) => edenDelete<T>(path),
  }
}
