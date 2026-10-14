import type {
  AssetUrlOptions,
  CollectionGetOptions,
  CollectionListOptions,
  CollectionSingletonOptions,
  CreatePreviewTokenOptions,
  EdgeCmsClientConfig,
  PaginatedListResponse,
  PreviewTokenResponse,
} from './types'

export class EdgeCmsClient {
  readonly baseUrl: string
  readonly tenantSlug: string
  readonly defaultLocale: string
  private readonly headers: Record<string, string>
  private readonly customFetch: typeof globalThis.fetch

  constructor(config: EdgeCmsClientConfig) {
    if (!config || typeof config !== 'object') {
      throw new Error('EdgeCMS client configuration is required.')
    }
    if (!config.baseUrl) {
      throw new Error('baseUrl is required in EdgeCMS client configuration.')
    }
    if (!config.tenantSlug) {
      throw new Error('tenantSlug is required in EdgeCMS client configuration.')
    }

    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.tenantSlug = config.tenantSlug
    this.defaultLocale = config.defaultLocale ?? 'en'
    this.customFetch = config.fetch ?? globalThis.fetch.bind(globalThis)
    this.headers = {
      Accept: 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      ...config.headers,
    }
  }

  collection<T = Record<string, unknown>>(slug: string) {
    if (!slug) {
      throw new Error('Collection slug is required.')
    }

    const { baseUrl, tenantSlug, defaultLocale, headers } = this
    const doFetch = this.fetch.bind(this)

    return {
      async list(options?: CollectionListOptions): Promise<PaginatedListResponse<T>> {
        const queryParams = new URLSearchParams()
        const locale = options?.locale || defaultLocale
        if (locale) queryParams.set('locale', locale)
        if (options?.page) queryParams.set('page', String(options.page))
        if (options?.perPage) queryParams.set('perPage', String(options.perPage))
        if (options?.sort) queryParams.set('sort', options.sort)
        if (options?.depth) queryParams.set('depth', String(options.depth))
        if (options?.previewToken) queryParams.set('previewToken', options.previewToken)

        if (options?.filter) {
          for (const [k, v] of Object.entries(options.filter)) {
            queryParams.set(k, String(v))
          }
        }

        const qs = queryParams.toString() ? `?${queryParams.toString()}` : ''
        const url = `${baseUrl}/api/tenants/${tenantSlug}/public/${slug}${qs}`
        const res = await doFetch(url, {
          method: 'GET',
          headers: {
            ...headers,
            ...(options?.previewToken ? { 'x-edgecms-preview-token': options.previewToken } : {}),
          },
        })

        if (!res.ok) {
          throw new Error(`EdgeCMS list request failed (${res.status}): ${await res.text()}`)
        }

        return (await res.json()) as PaginatedListResponse<T>
      },

      async get(entrySlugOrId: string, options?: CollectionGetOptions): Promise<T> {
        if (!entrySlugOrId) {
          throw new Error('Entry slug or ID is required.')
        }

        const queryParams = new URLSearchParams()
        const locale = options?.locale || defaultLocale
        if (locale) queryParams.set('locale', locale)
        if (options?.populate) queryParams.set('populate', options.populate)
        if (options?.depth) queryParams.set('depth', String(options.depth))
        if (options?.previewToken) queryParams.set('previewToken', options.previewToken)

        const qs = queryParams.toString() ? `?${queryParams.toString()}` : ''
        const url = `${baseUrl}/api/tenants/${tenantSlug}/public/${slug}/${encodeURIComponent(entrySlugOrId)}${qs}`
        const res = await doFetch(url, {
          method: 'GET',
          headers: {
            ...headers,
            ...(options?.previewToken ? { 'x-edgecms-preview-token': options.previewToken } : {}),
          },
        })

        if (!res.ok) {
          throw new Error(`EdgeCMS get request failed (${res.status}): ${await res.text()}`)
        }

        return (await res.json()) as T
      },

      async getSingleton(options?: CollectionSingletonOptions): Promise<T> {
        const queryParams = new URLSearchParams()
        const locale = options?.locale || defaultLocale
        if (locale) queryParams.set('locale', locale)
        if (options?.previewToken) queryParams.set('previewToken', options.previewToken)

        const qs = queryParams.toString() ? `?${queryParams.toString()}` : ''
        const url = `${baseUrl}/api/tenants/${tenantSlug}/public/singleton/${slug}${qs}`
        const res = await doFetch(url, {
          method: 'GET',
          headers: {
            ...headers,
            ...(options?.previewToken ? { 'x-edgecms-preview-token': options.previewToken } : {}),
          },
        })

        if (!res.ok) {
          throw new Error(`EdgeCMS getSingleton request failed (${res.status}): ${await res.text()}`)
        }

        return (await res.json()) as T
      },
    }
  }

  async createPreviewToken(options: CreatePreviewTokenOptions = {}): Promise<PreviewTokenResponse> {
    const url = `${this.baseUrl}/api/tenants/${this.tenantSlug}/public/preview-token`
    const res = await this.fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantSlug: this.tenantSlug,
        entrySlug: options.entrySlug,
        entryId: options.entryId,
        collectionSlug: options.collectionSlug,
        previewUrl: options.previewUrl,
        ttlSeconds: options.ttlSeconds,
      }),
    })

    if (!res.ok) {
      throw new Error(`EdgeCMS createPreviewToken failed (${res.status}): ${await res.text()}`)
    }

    return (await res.json()) as PreviewTokenResponse
  }

  getAssetUrl(assetId: string, options?: AssetUrlOptions): string {
    if (!assetId) return ''
    const variant = options?.variant ?? 'original'
    const format = options?.format
    const path = format
      ? `/api/tenants/${this.tenantSlug}/public/assets/${assetId}/${variant}.${format}`
      : `/api/tenants/${this.tenantSlug}/public/assets/${assetId}/${variant}`

    const url = new URL(`${this.baseUrl}${path}`)
    if (options?.width) url.searchParams.set('w', String(options.width))
    if (options?.height) url.searchParams.set('h', String(options.height))
    if (options?.fit) url.searchParams.set('fit', options.fit)
    return url.toString()
  }

  private fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    return this.customFetch(input, init)
  }
}

export function createEdgeCmsClient(config: EdgeCmsClientConfig): EdgeCmsClient {
  return new EdgeCmsClient(config)
}
