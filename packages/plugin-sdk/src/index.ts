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

// ---------------------------------------------------------------------------
// HS-10: host admin contributions
//
// A trusted plugin can add admin navigation pages, panels in fixed slots and
// banners. Contributions come from a build-time catalog compiled into the
// admin bundle (P8): there is no field for remote URLs, HTML or scripts, and
// banner text renders as plain text. `TComponent` is the admin's component
// type (React in the bundled admin); the SDK stays framework-free.
// ---------------------------------------------------------------------------

/**
 * Who may see a contribution. The admin checks this before rendering; it is a
 * display gate only, so any API route the component calls must still enforce
 * its own permissions.
 *
 * - `tenant:read`: any member of the active tenant (any signed-in user outside a tenant).
 * - `tenant:write`: tenant editors, admins and owners (global admins outside a tenant).
 * - `tenant:manage`: tenant admins and owners (global admins outside a tenant).
 * - `superadmin`: deployment super-admins only.
 */
export type PluginAdminAccess = 'tenant:read' | 'tenant:write' | 'tenant:manage' | 'superadmin'

export const PLUGIN_ADMIN_ACCESS_LEVELS = [
  'tenant:read',
  'tenant:write',
  'tenant:manage',
  'superadmin',
] as const satisfies readonly PluginAdminAccess[]

/** Fixed places in the admin where a panel can render. */
export type PluginAdminPanelSlot = 'dashboard' | 'settings'

export const PLUGIN_ADMIN_PANEL_SLOTS = [
  'dashboard',
  'settings',
] as const satisfies readonly PluginAdminPanelSlot[]

export type PluginAdminBannerTone = 'info' | 'warning'

export const PLUGIN_ADMIN_BANNER_TONES = [
  'info',
  'warning',
] as const satisfies readonly PluginAdminBannerTone[]

/** Per-plugin caps so one plugin cannot crowd out the core admin. */
export const PLUGIN_ADMIN_CONTRIBUTION_LIMITS = {
  navItems: 8,
  panels: 4,
  banners: 3,
} as const

/**
 * A sidebar link to a page the plugin renders. The admin derives the route,
 * `/tenants/:tenantSlug/plugins/:pluginName/:id`, so a plugin cannot claim a
 * core path. Navigation items appear inside a tenant workspace only.
 */
export type PluginAdminNavItem<TComponent = unknown> = {
  /** Lowercase slug, unique within the plugin's nav items. Becomes the last route segment. */
  id: string
  label: string
  access: PluginAdminAccess
  /** Sidebar group title. Defaults to `Extensions`. */
  group?: string
  icon?: TComponent
  /** Page body rendered at the derived route. */
  component: TComponent
}

export type PluginAdminPanel<TComponent = unknown> = {
  id: string
  slot: PluginAdminPanelSlot
  title: string
  description?: string
  access: PluginAdminAccess
  component: TComponent
}

export type PluginAdminBannerLink = {
  label: string
  /** An admin path starting with `/`, or an `https://` URL. */
  href: string
}

export type PluginAdminBanner = {
  id: string
  tone: PluginAdminBannerTone
  /** Plain text; never rendered as HTML. */
  message: string
  access: PluginAdminAccess
  link?: PluginAdminBannerLink
  /** Defaults to `true`. Dismissal is remembered per browser. */
  dismissible?: boolean
}

export type PluginAdminContributions<TComponent = unknown> = {
  navItems?: PluginAdminNavItem<TComponent>[]
  panels?: PluginAdminPanel<TComponent>[]
  banners?: PluginAdminBanner[]
}

/** One entry in the admin's build-time trusted contribution catalog. */
export type TrustedAdminContributionEntry<TComponent = unknown> = {
  pluginName: string
  /**
   * When `true`, the contributions render only while the API reports this
   * plugin as `loaded` (`GET /api/admin/plugins`); hidden while that is
   * unknown. Either way, a plugin the API reports as `disabled` or `blocked`
   * contributes nothing.
   */
  requiresLoadedApiPlugin?: boolean
  contributions: PluginAdminContributions<TComponent>
}

export type PluginAdminContributionIssueCode =
  | 'INVALID_PLUGIN_NAME'
  | 'DUPLICATE_PLUGIN'
  | 'INVALID_SHAPE'
  | 'UNKNOWN_FIELD'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'INVALID_TEXT'
  | 'INVALID_ACCESS'
  | 'INVALID_SLOT'
  | 'INVALID_TONE'
  | 'INVALID_LINK'
  | 'MISSING_COMPONENT'
  | 'TOO_MANY'

export type PluginAdminContributionIssue = {
  pluginName: string
  /** Where the problem is, e.g. `banners[0].link.href`. */
  path: string
  code: PluginAdminContributionIssueCode
  message: string
}

export type ResolvedPluginAdminNavItem<TComponent = unknown> = PluginAdminNavItem<TComponent> & {
  pluginName: string
  requiresLoadedApiPlugin: boolean
}

export type ResolvedPluginAdminPanel<TComponent = unknown> = PluginAdminPanel<TComponent> & {
  pluginName: string
  requiresLoadedApiPlugin: boolean
}

export type ResolvedPluginAdminBanner = PluginAdminBanner & {
  pluginName: string
  requiresLoadedApiPlugin: boolean
}

export type ComposedAdminContributions<TComponent = unknown> = {
  navItems: ResolvedPluginAdminNavItem<TComponent>[]
  panels: ResolvedPluginAdminPanel<TComponent>[]
  banners: ResolvedPluginAdminBanner[]
  /** Plugins whose contributions were dropped, with every issue found. */
  rejected: Array<{ pluginName: string; issues: PluginAdminContributionIssue[] }>
}

const ADMIN_PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const ADMIN_CONTRIBUTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/
// Admin-relative path: one leading slash, not protocol-relative (`//`, `/\`).
const ADMIN_RELATIVE_HREF_PATTERN = /^\/(?![/\\])[^\s<>"'`\\]*$/
const HTTPS_HREF_PATTERN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?(\/[^\s<>"'`\\]*)?$/i
// C0 controls and DEL; banner and label text must be printable.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const ENTRY_FIELDS = ['pluginName', 'requiresLoadedApiPlugin', 'contributions'] as const
const CONTRIBUTION_FIELDS = ['navItems', 'panels', 'banners'] as const
const NAV_ITEM_FIELDS = ['id', 'label', 'access', 'group', 'icon', 'component'] as const
const PANEL_FIELDS = ['id', 'slot', 'title', 'description', 'access', 'component'] as const
const BANNER_FIELDS = ['id', 'tone', 'message', 'access', 'link', 'dismissible'] as const
const LINK_FIELDS = ['label', 'href'] as const

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isComponentLike(value: unknown): boolean {
  // Function components, classes, and React's memo/lazy/forwardRef objects.
  return typeof value === 'function' || (typeof value === 'object' && value !== null)
}

/** `true` for an admin path starting with `/` or an `https://` URL. */
export function isSafeAdminContributionHref(href: unknown): boolean {
  if (typeof href !== 'string' || href.length === 0 || href.length > 2048) return false
  return ADMIN_RELATIVE_HREF_PATTERN.test(href) || HTTPS_HREF_PATTERN.test(href)
}

/**
 * Check one catalog entry. Returns every issue found; an empty array means the
 * entry is valid. Unknown fields are rejected so a contribution cannot smuggle
 * in fields (raw HTML, script URLs) that a future renderer might trust.
 */
export function validateAdminContributionEntry(entry: unknown): PluginAdminContributionIssue[] {
  const issues: PluginAdminContributionIssue[] = []
  const rawName = isPlainRecord(entry) ? entry.pluginName : undefined
  const pluginName = typeof rawName === 'string' ? rawName : '<unknown>'
  const report = (path: string, code: PluginAdminContributionIssueCode, message: string) => {
    issues.push({ pluginName, path, code, message })
  }

  if (!isPlainRecord(entry)) {
    report('', 'INVALID_SHAPE', 'Catalog entry must be an object.')
    return issues
  }

  const checkFields = (value: Record<string, unknown>, allowed: readonly string[], path: string) => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        report(path ? `${path}.${key}` : key, 'UNKNOWN_FIELD', `Unknown field "${key}".`)
      }
    }
  }

  const checkText = (value: unknown, path: string, max: number, required: boolean) => {
    if (value === undefined && !required) return
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
      report(path, 'INVALID_TEXT', `Must be non-empty text of at most ${max} characters.`)
      return
    }
    if (CONTROL_CHARACTER_PATTERN.test(value)) {
      report(path, 'INVALID_TEXT', 'Must not contain control characters.')
    }
  }

  const checkAccess = (value: unknown, path: string) => {
    if (!(PLUGIN_ADMIN_ACCESS_LEVELS as readonly unknown[]).includes(value)) {
      report(path, 'INVALID_ACCESS', `Must be one of ${PLUGIN_ADMIN_ACCESS_LEVELS.join(', ')}.`)
    }
  }

  const checkList = (
    value: unknown,
    kind: keyof typeof PLUGIN_ADMIN_CONTRIBUTION_LIMITS,
    checkItem: (item: Record<string, unknown>, path: string) => void
  ) => {
    if (value === undefined) return
    const basePath = `contributions.${kind}`
    if (!Array.isArray(value)) {
      report(basePath, 'INVALID_SHAPE', 'Must be an array.')
      return
    }
    const limit = PLUGIN_ADMIN_CONTRIBUTION_LIMITS[kind]
    if (value.length > limit) {
      report(basePath, 'TOO_MANY', `At most ${limit} ${kind} per plugin.`)
    }
    const seen = new Set<string>()
    value.forEach((item, index) => {
      const path = `${basePath}[${index}]`
      if (!isPlainRecord(item)) {
        report(path, 'INVALID_SHAPE', 'Must be an object.')
        return
      }
      const id = item.id
      if (typeof id !== 'string' || !ADMIN_CONTRIBUTION_ID_PATTERN.test(id)) {
        report(`${path}.id`, 'INVALID_ID', 'Must be a lowercase slug (a-z, 0-9, -), at most 48 characters.')
      } else if (seen.has(id)) {
        report(`${path}.id`, 'DUPLICATE_ID', `Duplicate id "${id}".`)
      } else {
        seen.add(id)
      }
      checkItem(item, path)
    })
  }

  checkFields(entry, ENTRY_FIELDS, '')

  if (typeof entry.pluginName !== 'string' || !ADMIN_PLUGIN_NAME_PATTERN.test(entry.pluginName)) {
    report('pluginName', 'INVALID_PLUGIN_NAME', 'Must be a lowercase slug (a-z, 0-9, -), at most 64 characters.')
  }

  if (
    entry.requiresLoadedApiPlugin !== undefined &&
    typeof entry.requiresLoadedApiPlugin !== 'boolean'
  ) {
    report('requiresLoadedApiPlugin', 'INVALID_SHAPE', 'Must be a boolean.')
  }

  const contributions = entry.contributions
  if (!isPlainRecord(contributions)) {
    report('contributions', 'INVALID_SHAPE', 'Must be an object.')
    return issues
  }
  checkFields(contributions, CONTRIBUTION_FIELDS, 'contributions')

  checkList(contributions.navItems, 'navItems', (item, path) => {
    checkFields(item, NAV_ITEM_FIELDS, path)
    checkText(item.label, `${path}.label`, 48, true)
    checkText(item.group, `${path}.group`, 48, false)
    checkAccess(item.access, `${path}.access`)
    if (!isComponentLike(item.component)) {
      report(`${path}.component`, 'MISSING_COMPONENT', 'Must be a bundled component.')
    }
    if (item.icon !== undefined && !isComponentLike(item.icon)) {
      report(`${path}.icon`, 'MISSING_COMPONENT', 'Must be a bundled component.')
    }
  })

  checkList(contributions.panels, 'panels', (item, path) => {
    checkFields(item, PANEL_FIELDS, path)
    checkText(item.title, `${path}.title`, 64, true)
    checkText(item.description, `${path}.description`, 160, false)
    checkAccess(item.access, `${path}.access`)
    if (!(PLUGIN_ADMIN_PANEL_SLOTS as readonly unknown[]).includes(item.slot)) {
      report(`${path}.slot`, 'INVALID_SLOT', `Must be one of ${PLUGIN_ADMIN_PANEL_SLOTS.join(', ')}.`)
    }
    if (!isComponentLike(item.component)) {
      report(`${path}.component`, 'MISSING_COMPONENT', 'Must be a bundled component.')
    }
  })

  checkList(contributions.banners, 'banners', (item, path) => {
    checkFields(item, BANNER_FIELDS, path)
    checkText(item.message, `${path}.message`, 280, true)
    checkAccess(item.access, `${path}.access`)
    if (!(PLUGIN_ADMIN_BANNER_TONES as readonly unknown[]).includes(item.tone)) {
      report(`${path}.tone`, 'INVALID_TONE', `Must be one of ${PLUGIN_ADMIN_BANNER_TONES.join(', ')}.`)
    }
    if (item.dismissible !== undefined && typeof item.dismissible !== 'boolean') {
      report(`${path}.dismissible`, 'INVALID_SHAPE', 'Must be a boolean.')
    }
    if (item.link !== undefined) {
      if (!isPlainRecord(item.link)) {
        report(`${path}.link`, 'INVALID_LINK', 'Must be an object with label and href.')
      } else {
        checkFields(item.link, LINK_FIELDS, `${path}.link`)
        checkText(item.link.label, `${path}.link.label`, 48, true)
        if (!isSafeAdminContributionHref(item.link.href)) {
          report(`${path}.link.href`, 'INVALID_LINK', 'Must be an admin path starting with "/" or an https:// URL.')
        }
      }
    }
  })

  return issues
}

/**
 * Validate a whole catalog and flatten it for rendering. Validation is
 * all-or-nothing per plugin: a plugin with any issue contributes nothing and
 * is listed in `rejected`. A plugin name listed twice rejects both entries.
 */
export function composeAdminContributions<TComponent = unknown>(
  catalog: readonly TrustedAdminContributionEntry<TComponent>[]
): ComposedAdminContributions<TComponent> {
  const result: ComposedAdminContributions<TComponent> = {
    navItems: [],
    panels: [],
    banners: [],
    rejected: [],
  }

  const nameCounts = new Map<string, number>()
  for (const entry of catalog) {
    const name = isPlainRecord(entry) && typeof entry.pluginName === 'string' ? entry.pluginName : ''
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  }

  for (const entry of catalog) {
    const issues = validateAdminContributionEntry(entry)
    const name = isPlainRecord(entry) && typeof entry.pluginName === 'string' ? entry.pluginName : '<unknown>'
    if ((nameCounts.get(name) ?? 0) > 1) {
      issues.push({
        pluginName: name,
        path: 'pluginName',
        code: 'DUPLICATE_PLUGIN',
        message: `Plugin "${name}" is listed more than once in the admin contribution catalog.`,
      })
    }
    if (issues.length > 0) {
      result.rejected.push({ pluginName: name, issues })
      continue
    }

    const owner = {
      pluginName: entry.pluginName,
      requiresLoadedApiPlugin: entry.requiresLoadedApiPlugin === true,
    }
    for (const item of entry.contributions.navItems ?? []) result.navItems.push({ ...item, ...owner })
    for (const item of entry.contributions.panels ?? []) result.panels.push({ ...item, ...owner })
    for (const item of entry.contributions.banners ?? []) result.banners.push({ ...item, ...owner })
  }

  return result
}
