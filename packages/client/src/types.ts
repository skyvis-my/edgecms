export type EdgeCmsClientConfig = {
  baseUrl: string
  tenantSlug: string
  defaultLocale?: string | undefined
  apiKey?: string | undefined
  headers?: Record<string, string> | undefined
  fetch?: typeof globalThis.fetch | undefined
}

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'neq'
  | 'in'
  | 'nin'
  | 'not_in'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'

export type FilterValue = string | number | boolean | null | undefined | (string | number)[]

export type FilterFieldCondition =
  | string
  | number
  | boolean
  | null
  | (string | number)[]
  | {
      [op in FilterOperator]?: FilterValue
    }
  | Record<string, FilterValue>

export type CollectionFilter = Record<string, FilterFieldCondition | undefined>

export type CollectionListOptions = {
  page?: number | undefined
  perPage?: number | undefined
  locale?: string | undefined
  sort?: string | undefined
  filter?: CollectionFilter | undefined
  depth?: number | undefined
  previewToken?: string | undefined
}

export type CollectionGetOptions = {
  locale?: string | undefined
  populate?: string | undefined
  depth?: number | undefined
  previewToken?: string | undefined
}

export type CollectionSingletonOptions = {
  locale?: string | undefined
  previewToken?: string | undefined
}

export type CreatePreviewTokenOptions = {
  entrySlug?: string | undefined
  entryId?: string | undefined
  collectionSlug?: string | undefined
  ttlSeconds?: number | undefined
  previewUrl?: string | undefined
}

export type PreviewTokenResponse = {
  token: string
  tenantSlug: string
  entrySlug?: string | undefined
  entryId?: string | undefined
  collectionSlug?: string | undefined
  previewUrl?: string | undefined
  expiresAt: string
  exp: number
}

export type AssetUrlOptions = {
  variant?: 'original' | 'thumbnail' | 'medium' | 'large' | string | undefined
  format?: 'webp' | 'avif' | 'jpeg' | 'png' | 'auto' | string | undefined
  width?: number | undefined
  height?: number | undefined
  fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad' | undefined
}

export type PaginationMeta = {
  total: number
  page: number
  perPage: number
  totalPages?: number
}

export type PaginatedListResponse<T> = {
  data: T[]
  meta?: PaginationMeta
  pagination?: PaginationMeta
}

/**
 * TipTap / ProseMirror JSON Node definition
 */
export type TipTapMark = {
  type: string
  attrs?: Record<string, unknown>
  [key: string]: unknown
}

export type TipTapNode = {
  type?: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  marks?: TipTapMark[]
  text?: string
  [key: string]: unknown
}

export type TipTapDoc = TipTapNode

export type RenderHtmlOptions = {
  customRenderers?: Record<string, (node: TipTapNode) => string>
}
