import type {
  AssetUrlOptions,
  CollectionGetOptions,
  CollectionListOptions,
  CollectionSingletonOptions,
  CreatePreviewTokenOptions,
  DirectUploadOptions,
  EdgeCmsClientConfig,
  PaginatedListResponse,
  PreviewTokenResponse,
  SearchOptions,
  SearchResponse,
} from './types'

const TOP_LEVEL_FILTER_FIELDS = new Set(['slug', 'createdAt', 'updatedAt', 'status'])

/**
 * Builds URLSearchParams for collection list queries, properly serializing structured filters.
 */
export function buildQueryParams(
  options?: CollectionListOptions,
  defaultLocale?: string
): URLSearchParams {
  const queryParams = new URLSearchParams()
  if (!options && !defaultLocale) return queryParams

  const locale = options?.locale || defaultLocale
  if (locale) queryParams.set('locale', locale)
  if (options?.page) queryParams.set('page', String(options.page))
  if (options?.perPage) queryParams.set('perPage', String(options.perPage))
  if (options?.sort) queryParams.set('sort', options.sort)
  if (options?.depth !== undefined) queryParams.set('depth', String(options.depth))
  if (options?.previewToken) queryParams.set('previewToken', options.previewToken)

  if (options?.filter) {
    for (const [key, value] of Object.entries(options.filter)) {
      if (value === undefined || value === null) continue

      // If the key is already a full filter expression (e.g. "filter[data.field][eq]")
      if (key.startsWith('filter[')) {
        const serialized = Array.isArray(value) ? value.join(',') : String(value)
        queryParams.set(key, serialized)
        continue
      }

      // Determine field path:
      // Preserves 'data.*' or allowed top-level fields (slug, createdAt, updatedAt, status).
      // Custom fields default to 'data.<field>'.
      const fieldPath =
        key.startsWith('data.') || TOP_LEVEL_FILTER_FIELDS.has(key)
          ? key
          : `data.${key}`

      // Check if value is a nested operator object (e.g. { eq: 'foo', gt: 10, in: ['a', 'b'] })
      if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [op, opValue] of Object.entries(value)) {
          if (opValue === undefined || opValue === null) continue
          const serializedValue = Array.isArray(opValue)
            ? opValue.join(',')
            : String(opValue)
          queryParams.set(`filter[${fieldPath}][${op}]`, serializedValue)
        }
      } else {
        // Plain scalar or array value: defaults to [eq] operator
        const serializedValue = Array.isArray(value)
          ? value.join(',')
          : String(value)
        queryParams.set(`filter[${fieldPath}][eq]`, serializedValue)
      }
    }
  }

  return queryParams
}

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
        const queryParams = buildQueryParams(options, defaultLocale)
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

  async search(options: SearchOptions): Promise<SearchResponse> {
    if (!options?.query) {
      throw new Error('Search query is required.')
    }
    const queryParams = new URLSearchParams()
    queryParams.set('q', options.query)
    if (options.limit) queryParams.set('limit', String(options.limit))
    if (options.locale || this.defaultLocale) {
      queryParams.set('locale', options.locale || this.defaultLocale)
    }
    if (options.collection) queryParams.set('collection', options.collection)

    const url = `${this.baseUrl}/api/tenants/${this.tenantSlug}/public/search?${queryParams.toString()}`
    const res = await this.fetch(url, {
      method: 'GET',
      headers: this.headers,
    })
    if (!res.ok) {
      throw new Error(`EdgeCMS search failed (${res.status}): ${await res.text()}`)
    }
    return (await res.json()) as SearchResponse
  }

  async uploadAssetDirect(options: DirectUploadOptions): Promise<unknown> {
    if (!options?.file) {
      throw new Error('File is required for upload.')
    }
    if (!options.filename) {
      throw new Error('Filename is required for upload.')
    }
    if (!options.mimeType) {
      throw new Error('MIME type is required for upload.')
    }

    const fileSize =
      'size' in options.file && typeof options.file.size === 'number'
        ? options.file.size
        : 'byteLength' in options.file && typeof options.file.byteLength === 'number'
          ? options.file.byteLength
          : 0

    // Step 1: Request presigned intent
    const intentUrl = `${this.baseUrl}/api/admin/assets/direct-upload-intent`
    const intentRes = await this.fetch(intentUrl, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: options.filename,
        mimeType: options.mimeType,
        size: fileSize,
        folderId: options.folderId,
      }),
    })
    if (!intentRes.ok) {
      throw new Error(`EdgeCMS direct upload intent failed (${intentRes.status}): ${await intentRes.text()}`)
    }
    const intent = (await intentRes.json()) as {
      uploadUrl: string
      key: string
      assetId: string
      uploadId: string
    }

    // Step 2: Upload directly to R2 presigned URL
    const uploadRes = await this.fetch(intent.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': options.mimeType,
      },
      body: options.file as BodyInit,
    })
    if (!uploadRes.ok) {
      throw new Error(`EdgeCMS R2 direct upload failed (${uploadRes.status}): ${await uploadRes.text()}`)
    }

    // Step 3: Confirm complete
    const completeUrl = `${this.baseUrl}/api/admin/assets/direct-upload-complete`
    const completeRes = await this.fetch(completeUrl, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assetId: intent.assetId,
        uploadId: intent.uploadId,
        key: intent.key,
        filename: options.filename,
        mimeType: options.mimeType,
        size: fileSize,
        altText: options.altText,
        folderId: options.folderId,
      }),
    })
    if (!completeRes.ok) {
      throw new Error(`EdgeCMS direct upload confirmation failed (${completeRes.status}): ${await completeRes.text()}`)
    }

    return await completeRes.json()
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
