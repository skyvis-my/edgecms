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
  /**
   * EX-02: semver range of EdgeCMS framework versions this plugin supports,
   * e.g. `>=0.2.0 <1.0.0`. Checked against the running framework version at
   * composition time. Omit to accept any version.
   */
  edgecms?: string
  /**
   * EX-02: other trusted catalog plugins this plugin needs, mapped to the
   * semver range of their `metadata.version`. Dependencies load first.
   */
  dependencies?: Record<string, string>
  /** EX-02: Worker bindings and secrets this plugin needs at runtime. */
  bindings?: PluginBindingRequirement[]
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
  | 'INVALID_CONTRACT'
  | 'INCOMPATIBLE_DEPENDENCY'
  | 'DEPENDENCY_BLOCKED'
  | 'DUPLICATE_PLUGIN'

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
  /** EX-02: every contract issue found at composition, when the plugin was blocked by one. */
  issues?: PluginContractIssue[]
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

// ---------------------------------------------------------------------------
// EX-02: versioned extension contract
//
// A trusted plugin declares the framework versions it supports (`edgecms`),
// the other catalog plugins it needs (`dependencies`) and the Worker bindings
// it reads (`bindings`). `composePluginContracts` checks all of them once, at
// composition time, and fails closed: a plugin with any issue, or one whose
// dependency was rejected, registers nothing. The semver matcher below is a
// small, dependency-free subset of node-semver range syntax that runs in a
// Worker.
// ---------------------------------------------------------------------------

export type SemverIdentifier = string | number

export type ParsedSemver = {
  major: number
  minor: number
  patch: number
  prerelease: SemverIdentifier[]
}

const SEMVER_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/
// A comparator: optional operator, then a full or partial version (`1`, `1.2`, `1.x`, `*`).
const COMPARATOR_PATTERN =
  /^(<=|>=|<|>|=|\^|~)?v?(\*|x|X|0|[1-9]\d*)(?:\.(\*|x|X|0|[1-9]\d*)(?:\.(\*|x|X|0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?)?)?$/
const MAX_SEMVER_LENGTH = 256

function parseSemverIdentifiers(raw: string | undefined): SemverIdentifier[] {
  if (!raw) return []
  return raw.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

/** Parse a full `major.minor.patch[-prerelease][+build]` version, or `null`. */
export function parseSemver(version: string): ParsedSemver | null {
  if (typeof version !== 'string' || version.length > MAX_SEMVER_LENGTH) return null
  const match = SEMVER_PATTERN.exec(version.trim())
  if (!match) return null
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (![major, minor, patch].every(Number.isSafeInteger)) return null
  return { major, minor, patch, prerelease: parseSemverIdentifiers(match[4]) }
}

function compareParsed(a: ParsedSemver, b: ParsedSemver): -1 | 0 | 1 {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  const ap = a.prerelease
  const bp = b.prerelease
  if (ap.length === 0 && bp.length === 0) return 0
  if (ap.length === 0) return 1
  if (bp.length === 0) return -1
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i]
    const y = bp[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

/** Compare two full versions by semver precedence. Throws on an invalid version. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (!left || !right) throw new Error(`Invalid semver: ${left ? b : a}`)
  return compareParsed(left, right)
}

type SemverBound = { op: '<' | '<=' | '>' | '>=' | '='; version: ParsedSemver }
type SemverComparatorSet = SemverBound[]

const ANY_VERSION: SemverBound = { op: '>=', version: { major: 0, minor: 0, patch: 0, prerelease: [] } }
// An exclusive upper bound below every prerelease of `version` (node-semver's `-0`).
const below = (major: number, minor: number, patch: number): SemverBound => ({
  op: '<',
  version: { major, minor, patch, prerelease: [0] },
})
const atLeast = (major: number, minor: number, patch: number, prerelease: SemverIdentifier[] = []): SemverBound => ({
  op: '>=',
  version: { major, minor, patch, prerelease },
})

function isWildcard(part: string | undefined): boolean {
  return part === undefined || part === '*' || part === 'x' || part === 'X'
}

/** Desugar one comparator token into plain bounds, or `null` when invalid. */
function parseComparator(token: string): SemverBound[] | null {
  const match = COMPARATOR_PATTERN.exec(token)
  if (!match) return null
  const op = match[1] ?? ''
  const [rawMajor, rawMinor, rawPatch, rawPre] = [match[2], match[3], match[4], match[5]]
  if (rawPre !== undefined && parseSemver(`0.0.0-${rawPre}`) === null) return null

  const xMajor = isWildcard(rawMajor)
  const xMinor = xMajor || isWildcard(rawMinor)
  const xPatch = xMinor || isWildcard(rawPatch)
  if (rawPre !== undefined && xPatch) return null
  const major = xMajor ? 0 : Number(rawMajor)
  const minor = xMinor ? 0 : Number(rawMinor)
  const patch = xPatch ? 0 : Number(rawPatch)
  const pre = parseSemverIdentifiers(rawPre)

  if (xMajor) {
    if (op === '<' || op === '>') return [below(0, 0, 0)] // matches nothing
    return [ANY_VERSION]
  }

  switch (op) {
    case '^': {
      if (major > 0 || xMinor) return [atLeast(major, minor, patch, pre), below(major + 1, 0, 0)]
      if (minor > 0 || xPatch) return [atLeast(0, minor, patch, pre), below(0, minor + 1, 0)]
      return [atLeast(0, 0, patch, pre), below(0, 0, patch + 1)]
    }
    case '~': {
      if (xMinor) return [atLeast(major, 0, 0), below(major + 1, 0, 0)]
      return [atLeast(major, minor, patch, pre), below(major, minor + 1, 0)]
    }
    case '>':
      if (xMinor) return [atLeast(major + 1, 0, 0)]
      if (xPatch) return [atLeast(major, minor + 1, 0)]
      return [{ op: '>', version: { major, minor, patch, prerelease: pre } }]
    case '>=':
      return [atLeast(major, minor, patch, pre)]
    case '<':
      return [{ op: '<', version: { major, minor, patch, prerelease: xPatch ? [0] : pre } }]
    case '<=':
      if (xMinor) return [below(major + 1, 0, 0)]
      if (xPatch) return [below(major, minor + 1, 0)]
      return [{ op: '<=', version: { major, minor, patch, prerelease: pre } }]
    default:
      if (xMinor) return [atLeast(major, 0, 0), below(major + 1, 0, 0)]
      if (xPatch) return [atLeast(major, minor, 0), below(major, minor + 1, 0)]
      return [{ op: '=', version: { major, minor, patch, prerelease: pre } }]
  }
}

function parseRange(range: string): SemverComparatorSet[] | null {
  if (typeof range !== 'string' || range.length > MAX_SEMVER_LENGTH) return null
  const sets: SemverComparatorSet[] = []
  for (const rawSet of range.split('||')) {
    const set = rawSet.trim().replace(/(<=|>=|<|>|=|\^|~)\s+/g, '$1')
    if (set.length === 0) {
      // `''` alone means any version; an empty side of `||` is a typo.
      if (range.trim().length === 0) {
        sets.push([ANY_VERSION])
        continue
      }
      return null
    }
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set)
    if (hyphen) {
      const low = parseComparator(`>=${hyphen[1]}`)
      const highToken = hyphen[2]!
      const high = parseComparator(`<=${highToken}`)
      if (!low || !high || /^[<>=^~]/.test(hyphen[1]!) || /^[<>=^~]/.test(highToken)) return null
      sets.push([...low, ...high])
      continue
    }
    const bounds: SemverBound[] = []
    for (const token of set.split(/\s+/)) {
      const parsed = parseComparator(token)
      if (!parsed) return null
      bounds.push(...parsed)
    }
    sets.push(bounds)
  }
  return sets
}

function boundAllows(bound: SemverBound, version: ParsedSemver): boolean {
  const cmp = compareParsed(version, bound.version)
  switch (bound.op) {
    case '<':
      return cmp < 0
    case '<=':
      return cmp <= 0
    case '>':
      return cmp > 0
    case '>=':
      return cmp >= 0
    default:
      return cmp === 0
  }
}

function setAllows(set: SemverComparatorSet, version: ParsedSemver): boolean {
  if (!set.every((bound) => boundAllows(bound, version))) return false
  if (version.prerelease.length === 0) return true
  // A prerelease only matches when a bound opts in on the same release tuple.
  return set.some(
    (bound) =>
      bound.version.prerelease.length > 0 &&
      !(bound.op === '<' && bound.version.prerelease.length === 1 && bound.version.prerelease[0] === 0) &&
      bound.version.major === version.major &&
      bound.version.minor === version.minor &&
      bound.version.patch === version.patch
  )
}

/** `true` when `range` uses supported syntax: `*`, `1.2.x`, `^`, `~`, `<`, `<=`, `>`, `>=`, `=`, `a - b`, spaces (and) and `||` (or). */
export function isValidSemverRange(range: string): boolean {
  return parseRange(range) !== null
}

/** `true` when `version` satisfies `range`. Fails closed: an invalid version or range never matches. */
export function satisfiesSemverRange(version: string, range: string): boolean {
  const parsed = parseSemver(version)
  const sets = parseRange(range)
  if (!parsed || !sets) return false
  return sets.some((set) => setAllows(set, parsed))
}

/** The Worker binding types a plugin can require. `secret` also covers plain string vars. */
export type PluginBindingKind = 'd1' | 'kv' | 'r2' | 'queue' | 'secret'

export const PLUGIN_BINDING_KINDS = [
  'd1',
  'kv',
  'r2',
  'queue',
  'secret',
] as const satisfies readonly PluginBindingKind[]

export type PluginBindingRequirement = {
  /** The binding name in the Worker env, e.g. `MEDIA` or `REVALIDATE_SECRET`. */
  name: string
  kind: PluginBindingKind
  /** Shown in the composition report to explain why the binding is needed. */
  description?: string
}

export type PluginContractIssueCode =
  | 'INVALID_CONTRACT'
  | 'INCOMPATIBLE_CORE'
  | 'MISSING_DEPENDENCY'
  | 'INCOMPATIBLE_DEPENDENCY'
  | 'DEPENDENCY_BLOCKED'
  | 'CYCLIC_DEPENDENCY'
  | 'MISSING_REQUIRED_BINDING'
  | 'DUPLICATE_PLUGIN'

export type PluginContractIssue = {
  pluginName: string
  /** Where the problem is, e.g. `dependencies.audit-trace` or `bindings[0]`. */
  path: string
  code: PluginContractIssueCode
  message: string
}

/** The part of a plugin definition the composition step reads. */
export type PluginContractDeclaration = Pick<PluginDefinition, 'edgecms' | 'dependencies' | 'bindings'> & {
  metadata?: Pick<PluginMetadata, 'version'>
}

export type PluginCompositionCandidate = {
  name: string
  definition: PluginContractDeclaration
}

export type PluginCompositionInput = {
  /** The running EdgeCMS framework version. */
  frameworkVersion: string
  /** Enabled, trusted plugins, in configuration order. */
  plugins: readonly PluginCompositionCandidate[]
  /** The Worker env. Omitted means no bindings are available. */
  env?: Record<string, unknown>
}

export type PluginCompositionRejection = {
  pluginName: string
  /** The first issue's code. */
  code: PluginContractIssueCode
  issues: PluginContractIssue[]
}

export type PluginCompositionReport = {
  frameworkVersion: string
  /** Admitted plugins, dependencies before dependents. Register in this order. */
  loadOrder: string[]
  /** Rejected plugins in configuration order; each registers nothing. */
  rejected: PluginCompositionRejection[]
}

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const BINDING_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/

const BINDING_LABELS: Record<PluginBindingKind, string> = {
  d1: 'D1 database',
  kv: 'KV namespace',
  r2: 'R2 bucket',
  queue: 'Queue producer',
  secret: 'secret or string var',
}

function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return methods.every((method) => typeof record[method] === 'function')
}

function matchesBindingKind(kind: PluginBindingKind, value: unknown): boolean {
  switch (kind) {
    case 'd1':
      return hasMethods(value, ['prepare', 'batch'])
    case 'kv':
      return hasMethods(value, ['get', 'put', 'getWithMetadata'])
    case 'r2':
      return hasMethods(value, ['get', 'put', 'head'])
    case 'queue':
      return hasMethods(value, ['send'])
    case 'secret':
      return typeof value === 'string' && value.trim().length > 0
  }
}

/**
 * Check a plugin's declared contract fields for shape. Returns every issue;
 * an empty array means the declaration is well formed.
 */
export function validatePluginContract(
  pluginName: string,
  definition: PluginContractDeclaration
): PluginContractIssue[] {
  const issues: PluginContractIssue[] = []
  const report = (path: string, message: string) =>
    issues.push({ pluginName, path, code: 'INVALID_CONTRACT', message })

  if (definition.edgecms !== undefined) {
    if (
      typeof definition.edgecms !== 'string' ||
      definition.edgecms.trim().length === 0 ||
      !isValidSemverRange(definition.edgecms)
    ) {
      report('edgecms', `"edgecms" must be a semver range such as ">=0.2.0 <1.0.0", got ${JSON.stringify(definition.edgecms)}.`)
    }
  }

  const dependencies = definition.dependencies
  if (dependencies !== undefined) {
    if (!isPlainRecord(dependencies)) {
      report('dependencies', '"dependencies" must map plugin names to semver ranges.')
    } else {
      for (const [dependency, range] of Object.entries(dependencies)) {
        const path = `dependencies.${dependency}`
        if (dependency === pluginName) {
          report(path, `Plugin "${pluginName}" cannot depend on itself.`)
        } else if (!PLUGIN_NAME_PATTERN.test(dependency)) {
          report(path, `Dependency name "${dependency}" must be a lowercase slug (a-z, 0-9, -).`)
        } else if (typeof range !== 'string' || range.trim().length === 0 || !isValidSemverRange(range)) {
          report(path, `Dependency "${dependency}" needs a semver range, got ${JSON.stringify(range)}.`)
        }
      }
    }
  }

  const bindings = definition.bindings
  if (bindings !== undefined) {
    if (!Array.isArray(bindings)) {
      report('bindings', '"bindings" must be an array of { name, kind }.')
    } else {
      const seen = new Set<string>()
      bindings.forEach((binding: unknown, index) => {
        const path = `bindings[${index}]`
        if (!isPlainRecord(binding)) {
          report(path, 'Each binding must be an object with name and kind.')
          return
        }
        const { name, kind } = binding
        if (typeof name !== 'string' || !BINDING_NAME_PATTERN.test(name)) {
          report(`${path}.name`, 'Binding name must be an uppercase env name (A-Z, 0-9, _).')
        } else if (seen.has(name)) {
          report(`${path}.name`, `Binding "${name}" is declared more than once.`)
        } else {
          seen.add(name)
        }
        if (!(PLUGIN_BINDING_KINDS as readonly unknown[]).includes(kind)) {
          report(`${path}.kind`, `Binding kind must be one of ${PLUGIN_BINDING_KINDS.join(', ')}.`)
        }
      })
    }
  }

  return issues
}

/**
 * Check declared bindings against the Worker env. Fails closed: a missing env,
 * a binding of the wrong type or an env that throws on read is an issue.
 */
export function checkPluginBindings(
  pluginName: string,
  bindings: readonly PluginBindingRequirement[],
  env: Record<string, unknown> | undefined
): PluginContractIssue[] {
  const issues: PluginContractIssue[] = []
  bindings.forEach((binding, index) => {
    let value: unknown
    try {
      value = env?.[binding.name]
    } catch {
      value = undefined
    }
    if (matchesBindingKind(binding.kind, value)) return
    const label = BINDING_LABELS[binding.kind] ?? binding.kind
    const why = binding.description ? ` (${binding.description})` : ''
    const found = value === undefined ? 'it is not set' : 'it is set to something else'
    issues.push({
      pluginName,
      path: `bindings[${index}]`,
      code: 'MISSING_REQUIRED_BINDING',
      message: `Plugin "${pluginName}" needs the ${label} binding "${binding.name}"${why}, but ${found}. Add it to the Worker config (wrangler.toml or a secret).`,
    })
  })
  return issues
}

/**
 * Validate every candidate's contract and resolve a load order. Rejection is
 * all-or-nothing per plugin and propagates to dependents. The order is
 * deterministic: dependencies first, otherwise configuration order.
 */
export function composePluginContracts(input: PluginCompositionInput): PluginCompositionReport {
  const { frameworkVersion, plugins, env } = input
  const issuesByIndex = plugins.map((): PluginContractIssue[] => [])
  const counts = new Map<string, number>()
  for (const candidate of plugins) counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1)
  const indexByName = new Map<string, number>()
  plugins.forEach((candidate, index) => {
    if (counts.get(candidate.name) === 1) indexByName.set(candidate.name, index)
  })

  // 1. Per-plugin checks: duplicates, shape, engine range, bindings, dependency resolution.
  plugins.forEach((candidate, index) => {
    const { name, definition } = candidate
    const issues = issuesByIndex[index]!
    if ((counts.get(name) ?? 0) > 1) {
      issues.push({
        pluginName: name,
        path: 'name',
        code: 'DUPLICATE_PLUGIN',
        message: `Plugin "${name}" is configured more than once.`,
      })
      return
    }
    const shapeIssues = validatePluginContract(name, definition)
    issues.push(...shapeIssues)
    if (shapeIssues.length > 0) return

    if (definition.edgecms !== undefined && !satisfiesSemverRange(frameworkVersion, definition.edgecms)) {
      issues.push({
        pluginName: name,
        path: 'edgecms',
        code: 'INCOMPATIBLE_CORE',
        message: `Plugin "${name}" supports EdgeCMS ${definition.edgecms}, but this is EdgeCMS ${frameworkVersion}.`,
      })
    }

    if (definition.bindings && definition.bindings.length > 0) {
      issues.push(...checkPluginBindings(name, definition.bindings, env))
    }

    for (const [dependency, range] of Object.entries(definition.dependencies ?? {})) {
      const path = `dependencies.${dependency}`
      const depIndex = indexByName.get(dependency)
      if (depIndex === undefined) {
        issues.push({
          pluginName: name,
          path,
          code: 'MISSING_DEPENDENCY',
          message: `Plugin "${name}" needs "${dependency}" ${range}, which is not enabled from the trusted catalog.`,
        })
        continue
      }
      const depVersion = plugins[depIndex]!.definition.metadata?.version
      if (typeof depVersion !== 'string' || !satisfiesSemverRange(depVersion, range)) {
        issues.push({
          pluginName: name,
          path,
          code: 'INCOMPATIBLE_DEPENDENCY',
          message:
            typeof depVersion === 'string'
              ? `Plugin "${name}" needs "${dependency}" ${range}, but version ${depVersion} is installed.`
              : `Plugin "${name}" needs "${dependency}" ${range}, but "${dependency}" declares no semver version.`,
        })
      }
    }
  })

  // Edges between resolvable candidates only; unresolved ones were reported above.
  const edges = plugins.map((candidate, index) =>
    issuesByIndex[index]!.some((issue) => issue.code === 'DUPLICATE_PLUGIN' || issue.code === 'INVALID_CONTRACT')
      ? []
      : Object.keys(candidate.definition.dependencies ?? {})
          .map((dependency) => indexByName.get(dependency))
          .filter((depIndex): depIndex is number => depIndex !== undefined)
  )

  // 2. Cycles: every plugin on a cycle is rejected, with the cycle in the message.
  const state = plugins.map(() => 0) // 0 unvisited, 1 on stack, 2 done
  const stack: number[] = []
  const onCycle = new Set<number>()
  const visit = (index: number) => {
    state[index] = 1
    stack.push(index)
    for (const next of edges[index]!) {
      if (state[next] === 1) {
        const cycle = stack.slice(stack.indexOf(next))
        cycle.forEach((member, position) => {
          if (onCycle.has(member)) return
          onCycle.add(member)
          // Start the cycle at this member: `b -> c -> a -> b`.
          const rotated = [...cycle.slice(position), ...cycle.slice(0, position), member]
          issuesByIndex[member]!.push({
            pluginName: plugins[member]!.name,
            path: 'dependencies',
            code: 'CYCLIC_DEPENDENCY',
            message: `Dependency cycle: ${rotated.map((i) => plugins[i]!.name).join(' -> ')}.`,
          })
        })
      } else if (state[next] === 0) {
        visit(next)
      }
    }
    stack.pop()
    state[index] = 2
  }
  plugins.forEach((_, index) => {
    if (state[index] === 0) visit(index)
  })

  // 3. Propagate: a plugin whose dependency is rejected is rejected too.
  const rejected = (index: number) => issuesByIndex[index]!.length > 0
  let changed = true
  while (changed) {
    changed = false
    plugins.forEach((candidate, index) => {
      if (rejected(index)) return
      const blocked = edges[index]!.filter(rejected)
      if (blocked.length === 0) return
      for (const depIndex of blocked) {
        issuesByIndex[index]!.push({
          pluginName: candidate.name,
          path: `dependencies.${plugins[depIndex]!.name}`,
          code: 'DEPENDENCY_BLOCKED',
          message: `Plugin "${candidate.name}" needs "${plugins[depIndex]!.name}", which was rejected.`,
        })
      }
      changed = true
    })
  }

  // 4. Load order: Kahn's algorithm, ties broken by configuration order.
  const admitted = plugins.map((_, index) => index).filter((index) => !rejected(index))
  const remaining = new Map(admitted.map((index) => [index, edges[index]!.length]))
  const loadOrder: string[] = []
  while (remaining.size > 0) {
    let next: number | undefined
    for (const [index, pending] of remaining) {
      if (pending === 0 && (next === undefined || index < next)) next = index
    }
    if (next === undefined) break // unreachable: cycles were rejected above
    remaining.delete(next)
    loadOrder.push(plugins[next]!.name)
    for (const [index] of remaining) {
      const count = edges[index]!.filter((dep) => dep === next).length
      if (count > 0) remaining.set(index, remaining.get(index)! - count)
    }
  }

  const rejections: PluginCompositionRejection[] = []
  const reportedDuplicates = new Set<string>()
  plugins.forEach((candidate, index) => {
    const issues = issuesByIndex[index]!
    if (issues.length === 0) return
    if (issues[0]!.code === 'DUPLICATE_PLUGIN') {
      if (reportedDuplicates.has(candidate.name)) return
      reportedDuplicates.add(candidate.name)
    }
    rejections.push({ pluginName: candidate.name, code: issues[0]!.code, issues })
  })

  return { frameworkVersion, loadOrder, rejected: rejections }
}
