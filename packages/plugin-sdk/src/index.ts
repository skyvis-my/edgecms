export const PLUGIN_SDK_VERSION = '0.1.0' as const

export type PluginCommandType = string

export type PluginHookContext = {
  requestId: string
  pathname: string
  method: string
  tenantScope?: string
  commandType?: string
  commandStatus?: 'success' | 'failed' | 'dry_run'
  commandId?: string
  actorSource?: string
  prompt?: string
  dryRun?: boolean
  commandCount?: number
}

export type PluginHook = (ctx: PluginHookContext) => void | Promise<void>

export type PluginHookName = 'beforeCommand' | 'afterCommand' | 'beforeAiCommand'

export type HookName = PluginHookName

export type PluginGeneratedCommand<
  TType extends PluginCommandType = PluginCommandType,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> = {
  type: TType
  payload: TPayload
}

export type PluginSchemaLike = unknown

export type PluginAiTool<
  TCommand extends PluginGeneratedCommand = PluginGeneratedCommand,
  TSchema = PluginSchemaLike,
> = {
  name: string
  description: string
  parameters: TSchema
  toCommands: (args: Record<string, unknown>) => TCommand[]
}

export type PluginRouteFactory<TApp = unknown> = () => TApp

export type PluginRouteKind = 'admin'

export type PluginRoutePath<TPluginName extends string = string> =
  | `/api/admin/plugins/${TPluginName}`
  | `/api/admin/plugins/${TPluginName}/${string}`

export type PluginRouteDescriptor<TPluginName extends string = string> = {
  name: string
  kind: PluginRouteKind
  path: PluginRoutePath<TPluginName>
}

export type PluginHealthResponse<TPluginName extends string = string> = {
  success: true
  data: {
    plugin: TPluginName
    status: 'ok' | 'healthy'
  }
}

export type PluginPreviewRevalidationEvent =
  | 'entry.published'
  | 'entry.updated'
  | 'entry.unpublished'

export type PluginPreviewRevalidationPayload = {
  event: PluginPreviewRevalidationEvent
  path: string
  tenantScope?: string
  contentId?: string
}

export type PluginSignedRevalidationRequest = {
  destination: string
  method: 'POST'
  headers: Record<'x-edgecms-signature' | 'x-webhook-signature', string>
  payload: PluginPreviewRevalidationPayload
}

export type PluginFieldType<TSchema = PluginSchemaLike> = {
  type: string
  label: string
  validator: TSchema
  defaultValue?: unknown
}

export type PluginMetadata = {
  displayName: string
  description: string
  version: string
  author?: string
  category?: string
  permissions?: string[]
}

export type PluginAdminMenuItem = {
  label: string
  path: string
  group?: string
}

export type PluginDefinition<
  TApp = unknown,
  TCommand extends PluginGeneratedCommand = PluginGeneratedCommand,
  TSchema = PluginSchemaLike,
> = {
  metadata?: PluginMetadata
  hooks: Partial<Record<PluginHookName, PluginHook>>
  aiTools?: PluginAiTool<TCommand, TSchema>[]
  routes?: Record<string, PluginRouteFactory<TApp>>
  fields?: PluginFieldType<TSchema>[]
  adminMenu?: PluginAdminMenuItem[]
}

export type TrustedPluginDefinition<
  TApp = unknown,
  TCommand extends PluginGeneratedCommand = PluginGeneratedCommand,
  TSchema = PluginSchemaLike,
> = PluginDefinition<TApp, TCommand, TSchema>

export type PluginCapability =
  | 'content:read'
  | 'content:write'
  | 'media:read'
  | 'media:write'
  | 'network:fetch'

export type PluginAdmissionRejectionCode =
  | 'DUPLICATE_OWNERSHIP'
  | 'MISSING_DEPENDENCY'
  | 'CYCLIC_DEPENDENCY'
  | 'INCOMPATIBLE_CORE'
  | 'INCOMPATIBLE_SDK'
  | 'MISSING_REQUIRED_BINDING'
  | 'UNAUTHORIZED_CONTRIBUTION'
  | 'UNTRUSTED_CATALOG'
  | 'UNAUTHORIZED_CAPABILITY'

export type PluginManifest = {
  name: string
  enabled?: boolean
  version?: string
  coreVersionRange?: string
  sdkVersionRange?: string
  dependencies?: string[]
  requiredBindings?: Array<'DB' | 'CACHE' | 'MEDIA' | 'WEBHOOK_QUEUE' | 'PUBLISH_SCHEDULER'>
  capabilities?: PluginCapability[]
  hooks?: Partial<Record<PluginHookName, PluginHook>>
  metadata?: PluginMetadata
}

export type LoadedPluginStatus = 'loaded' | 'blocked' | 'disabled'

export type LoadedPluginSandbox = 'trusted_catalog' | 'worker_isolate' | 'untrusted_isolate'

export type LoadedPluginMetadata = {
  name: string
  enabled: boolean
  hooks: PluginHookName[]
  aiTools: string[]
  routes: string[]
  adminRoutes: string[]
  publicRoutes: string[]
  status: LoadedPluginStatus
  sandbox: LoadedPluginSandbox
  metadata?: PluginMetadata
  adminMenu: PluginAdminMenuItem[]
  reason?: string
  rejectionCode?: PluginAdmissionRejectionCode
}

export type PluginAdminListResponse = {
  success: true
  data: LoadedPluginMetadata[]
}

export type PluginAdminToggleResponse = {
  success: true
  data: {
    pluginName: string
    enabled: boolean
  }
}
