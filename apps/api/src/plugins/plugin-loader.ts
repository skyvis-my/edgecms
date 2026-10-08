import { Elysia } from 'elysia'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import {
  type HookName,
  type PluginRegistry,
  pluginRegistry,
} from './plugin-registry'
import {
  type AnyElysia,
  getTrustedPluginDefinition,
  type TrustedPluginAiTool,
  type TrustedPluginAdminMenuItem,
  type TrustedPluginDefinition,
  type TrustedPluginFieldType,
  type TrustedPluginRouteFactory,
} from './trusted-plugin-catalog'

import {
  PLUGIN_SDK_VERSION,
  type PluginAdmissionRejectionCode,
  type PluginCapability,
  type PluginManifest,
} from '@edgecms/plugin-sdk'
import { API_VERSION } from '@/version'
import {
  VALID_PLUGIN_CAPABILITIES,
  validatePluginCapabilities,
  UntrustedPluginSandboxAdapter,
  PluginCapabilityError,
  type SandboxedPluginExecutionScope,
  type UntrustedPluginSandboxOptions,
} from './worker-loader'

export {
  PLUGIN_SDK_VERSION,
  VALID_PLUGIN_CAPABILITIES,
  validatePluginCapabilities,
  UntrustedPluginSandboxAdapter,
  PluginCapabilityError,
}
export type {
  PluginAdmissionRejectionCode,
  PluginCapability,
  PluginManifest,
  SandboxedPluginExecutionScope,
  UntrustedPluginSandboxOptions,
}

type PluginConfigEntry = {
  name: string
  enabled?: boolean
}

type PluginLoadOptions = {
  kv?: KVNamespace
}

import type {
  LoadedPluginMetadata,
  LoadedPluginSandbox,
  LoadedPluginStatus,
} from '@edgecms/plugin-sdk'

export type {
  LoadedPluginMetadata,
  LoadedPluginSandbox,
  LoadedPluginStatus,
}



function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function cloneForSandbox<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

function sanitizeToolCommands(raw: unknown): Array<{
  type: CommandEnvelope['type']
  payload: Record<string, unknown>
}> {
  if (!Array.isArray(raw)) return []
  const sanitized: Array<{
    type: CommandEnvelope['type']
    payload: Record<string, unknown>
  }> = []
  for (const command of raw) {
    if (!command || typeof command !== 'object') continue
    const typed = command as { type?: unknown; payload?: unknown }
    if (typeof typed.type !== 'string' || typed.type.length === 0) continue
    if (!typed.payload || typeof typed.payload !== 'object' || Array.isArray(typed.payload)) continue
    sanitized.push({
      type: typed.type as CommandEnvelope['type'],
      payload: typed.payload as Record<string, unknown>,
    })
  }
  return sanitized.slice(0, 20)
}

function getRoutePaths(routeApp: AnyElysia): string[] {
  const history =
    (routeApp as unknown as {
      router?: { history?: Array<{ path?: unknown }> }
    }).router?.history ?? []
  return history
    .map((route) => route.path)
    .filter((path): path is string => typeof path === 'string')
}

type PluginRouteKind = 'admin' | 'public'

function getSandboxedPluginRouteKind(pluginName: string, path: string): PluginRouteKind | undefined {
  if (path === `/api/admin/plugins/${pluginName}`) return 'admin'
  if (path.startsWith(`/api/admin/plugins/${pluginName}/`)) return 'admin'
  return undefined
}

function isSafeAdminMenuPath(pluginName: string, path: string): boolean {
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('://')) return false
  return path.startsWith('/settings') || path.startsWith(`/plugins/${pluginName}`)
}

function getTrustedAdminMenu(
  pluginName: string,
  trustedPlugin: TrustedPluginDefinition | undefined
): { adminMenu: TrustedPluginAdminMenuItem[]; blockedAdminMenuLabels: string[] } {
  const adminMenu: TrustedPluginAdminMenuItem[] = []
  const blockedAdminMenuLabels: string[] = []

  for (const item of trustedPlugin?.adminMenu ?? []) {
    if (isSafeAdminMenuPath(pluginName, item.path)) {
      adminMenu.push({ ...item })
    } else {
      blockedAdminMenuLabels.push(item.label)
    }
  }

  return { adminMenu, blockedAdminMenuLabels }
}

function parseSemver(v: string): [number, number, number] | null {
  const parts = v.trim().replace(/^[\^~>=<]+/, '').split('.').map(Number)
  if (parts.length < 3 || parts.some(n => Number.isNaN(n))) return null
  return [parts[0]!, parts[1]!, parts[2]!]
}

function isCompatibleVersion(actualVersion: string, expectedRange: string | undefined): boolean {
  if (!expectedRange || expectedRange === '*' || expectedRange === 'latest') return true
  const actual = parseSemver(actualVersion)
  const expected = parseSemver(expectedRange)
  if (!actual || !expected) return true
  // Match major versions for semantic compatibility
  return actual[0] === expected[0]
}

export type AdmissionFailure = {
  rejectionCode: PluginAdmissionRejectionCode
  reason: string
}

function hasCyclicDependency(
  pluginName: string,
  allManifests: PluginManifest[],
  visited: Set<string> = new Set(),
  stack: Set<string> = new Set()
): boolean {
  if (stack.has(pluginName)) return true
  if (visited.has(pluginName)) return false

  visited.add(pluginName)
  stack.add(pluginName)

  const manifest = allManifests.find((m) => m.name === pluginName)
  if (manifest?.dependencies) {
    for (const dep of manifest.dependencies) {
      if (hasCyclicDependency(dep, allManifests, visited, stack)) {
        return true
      }
    }
  }

  stack.delete(pluginName)
  return false
}

export function validatePluginAdmission(
  manifest: PluginManifest,
  allManifests: PluginManifest[],
  trustedPlugin: TrustedPluginDefinition | undefined,
  activeBindings?: Record<string, unknown>,
  claimedRouteNames?: Set<string>
): AdmissionFailure | null {
  if (!trustedPlugin) {
    return {
      rejectionCode: 'UNTRUSTED_CATALOG',
      reason: 'Plugin is not in trusted catalog and was not loaded',
    }
  }

  // 1. Duplicate Route Ownership
  if (claimedRouteNames && trustedPlugin.routes) {
    for (const routeName of Object.keys(trustedPlugin.routes)) {
      if (claimedRouteNames.has(routeName)) {
        return {
          rejectionCode: 'DUPLICATE_OWNERSHIP',
          reason: `Duplicate route ownership detected for '${routeName}'`,
        }
      }
    }
  }

  // 2. Cyclic Dependencies
  if (manifest.dependencies && manifest.dependencies.length > 0) {
    if (hasCyclicDependency(manifest.name, allManifests)) {
      return {
        rejectionCode: 'CYCLIC_DEPENDENCY',
        reason: `Cyclic dependency detected for plugin '${manifest.name}'`,
      }
    }
  }

  // 3. Incompatible Core
  if (manifest.coreVersionRange && !isCompatibleVersion(API_VERSION, manifest.coreVersionRange)) {
    return {
      rejectionCode: 'INCOMPATIBLE_CORE',
      reason: `Plugin requires EdgeCMS core ${manifest.coreVersionRange}, but current version is ${API_VERSION}`,
    }
  }

  // 4. Incompatible SDK
  if (manifest.sdkVersionRange && !isCompatibleVersion(PLUGIN_SDK_VERSION, manifest.sdkVersionRange)) {
    return {
      rejectionCode: 'INCOMPATIBLE_SDK',
      reason: `Plugin requires Plugin SDK ${manifest.sdkVersionRange}, but current version is ${PLUGIN_SDK_VERSION}`,
    }
  }

  // 5. Missing Dependencies
  if (manifest.dependencies && manifest.dependencies.length > 0) {
    const available = new Set(allManifests.filter((m) => m.enabled !== false).map((m) => m.name))
    for (const dep of manifest.dependencies) {
      if (!available.has(dep)) {
        return {
          rejectionCode: 'MISSING_DEPENDENCY',
          reason: `Missing required plugin dependency: '${dep}'`,
        }
      }
    }
  }

  // 6. Missing Required Cloudflare Bindings
  if (manifest.requiredBindings && manifest.requiredBindings.length > 0 && activeBindings) {
    for (const binding of manifest.requiredBindings) {
      if (!activeBindings[binding]) {
        return {
          rejectionCode: 'MISSING_REQUIRED_BINDING',
          reason: `Missing required environment binding: '${binding}'`,
        }
      }
    }
  }

  // 7. Unauthorized / Invalid Capabilities
  if (manifest.capabilities && manifest.capabilities.length > 0) {
    const { valid, invalidCapabilities } = validatePluginCapabilities(manifest.capabilities)
    if (!valid) {
      return {
        rejectionCode: 'UNAUTHORIZED_CAPABILITY',
        reason: `Plugin '${manifest.name}' requested unauthorized capabilities: ${invalidCapabilities.join(', ')}`,
      }
    }
  }

  return null
}


export function parsePluginConfig(raw: string | undefined): PluginManifest[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((entry): entry is PluginConfigEntry => {
        if (!entry || typeof entry !== 'object') return false
        return typeof (entry as { name?: unknown }).name === 'string'
      })
      .map((entry) => {
        const rawEntry = entry as Record<string, unknown>
        const dependencies = Array.isArray(rawEntry.dependencies)
          ? rawEntry.dependencies.filter((d): d is string => typeof d === 'string')
          : undefined
        const requiredBindings = Array.isArray(rawEntry.requiredBindings)
          ? (rawEntry.requiredBindings.filter((b): b is 'DB' | 'CACHE' | 'MEDIA' | 'WEBHOOK_QUEUE' | 'PUBLISH_SCHEDULER' =>
              typeof b === 'string') as Array<'DB' | 'CACHE' | 'MEDIA' | 'WEBHOOK_QUEUE' | 'PUBLISH_SCHEDULER'>)
          : undefined
        const capabilities = Array.isArray(rawEntry.capabilities)
          ? (rawEntry.capabilities.filter((c): c is PluginCapability => typeof c === 'string'))
          : undefined

        return {
          name: entry.name.trim(),
          enabled: typeof entry.enabled === 'boolean' ? entry.enabled : true,
          version: typeof rawEntry.version === 'string' ? rawEntry.version : undefined,
          dependencies,
          requiredBindings,
          capabilities,
          coreVersionRange: typeof rawEntry.coreVersionRange === 'string' ? rawEntry.coreVersionRange : undefined,
          sdkVersionRange: typeof rawEntry.sdkVersionRange === 'string' ? rawEntry.sdkVersionRange : undefined,
        }
      })
      .filter((entry) => entry.name.length > 0)
  } catch {
    return []
  }
}

function createDefaultRegistry(): PluginRegistry {
  if (typeof (pluginRegistry as any)?.createRegistry === 'function') {
    return (pluginRegistry as any).createRegistry()
  }
  if (typeof pluginRegistry?.constructor === 'function') {
    try {
      return new (pluginRegistry.constructor as any)()
    } catch {
      // fallback
    }
  }
  return pluginRegistry
}

export class PluginRuntime {
  public readonly registry: PluginRegistry
  private loadedPlugins: LoadedPluginMetadata[] = []
  private loadedPluginAiTools: TrustedPluginAiTool[] = []
  private loadedPluginFields: TrustedPluginFieldType[] = []
  private loadedPluginRoutes: Array<{
    pluginName: string
    routeName: string
    createRoute: TrustedPluginRouteFactory
  }> = []

  constructor(registry: PluginRegistry = createDefaultRegistry()) {
    this.registry = registry
    registryRuntimeMap.set(this.registry, this)
  }

  getLoadedPlugins(): LoadedPluginMetadata[] {
    return this.loadedPlugins.map((plugin) => {
      const entry: LoadedPluginMetadata = {
        name: plugin.name,
        enabled: plugin.enabled,
        hooks: [...plugin.hooks],
        aiTools: [...plugin.aiTools],
        routes: [...plugin.routes],
        adminRoutes: [...plugin.adminRoutes],
        publicRoutes: [...plugin.publicRoutes],
        status: plugin.status,
        sandbox: plugin.sandbox,
        adminMenu: plugin.adminMenu.map((item) => ({ ...item })),
      }
      if (plugin.metadata !== undefined) {
        entry.metadata = { ...plugin.metadata }
      }
      if (plugin.reason !== undefined) {
        entry.reason = plugin.reason
      }
      if (plugin.rejectionCode !== undefined) {
        entry.rejectionCode = plugin.rejectionCode
      }
      return entry
    })
  }

  getLoadedPluginAiTools(): TrustedPluginAiTool[] {
    return this.loadedPluginAiTools.map((tool) => ({ ...tool }))
  }

  getLoadedPluginFields(): TrustedPluginFieldType[] {
    return this.loadedPluginFields.map((field) => ({ ...field }))
  }

  clear(): void {
    this.registry.clear()
    this.loadedPlugins = []
    this.loadedPluginAiTools = []
    this.loadedPluginFields = []
    this.loadedPluginRoutes = []
  }

  createLoadedPluginRoutesController(): AnyElysia {
    const app = new Elysia() as AnyElysia
    for (const routeFactory of this.loadedPluginRoutes) {
      app.use(routeFactory.createRoute() as AnyElysia)
    }
    return app
  }

  loadPluginsSync(
    manifests: PluginManifest[],
    trustedPluginResolver: (name: string) => TrustedPluginDefinition | undefined = getTrustedPluginDefinition
  ): PluginRegistry {
    const currentHookTimeoutMs = this.registry.getHookTimeoutMs()
    this.registry.clear()
    this.registry.setHookTimeoutMs(currentHookTimeoutMs)
    this.loadedPlugins = []
    this.loadedPluginAiTools = []
    this.loadedPluginFields = []
    this.loadedPluginRoutes = []
    const loadedToolNames = new Set<string>()
    const claimedRouteNames = new Set<string>()

    for (const manifest of manifests) {
      const enabled = manifest.enabled !== false
      const trustedPlugin = trustedPluginResolver(manifest.name)

      if (!enabled) {
        const { adminMenu, blockedAdminMenuLabels } = getTrustedAdminMenu(
          manifest.name,
          trustedPlugin
        )
        this.loadedPlugins.push({
          name: manifest.name,
          enabled: false,
          hooks: trustedPlugin ? (Object.keys(trustedPlugin.hooks) as HookName[]) : [],
          aiTools: trustedPlugin?.aiTools?.map((tool) => tool.name) ?? [],
          routes: Object.keys(trustedPlugin?.routes ?? {}),
          adminRoutes: [],
          publicRoutes: [],
          status: 'disabled',
          sandbox: 'trusted_catalog',
          metadata: trustedPlugin?.metadata ? { ...trustedPlugin.metadata } : undefined,
          adminMenu,
          reason:
            blockedAdminMenuLabels.length > 0
              ? `Blocked unsafe plugin admin menu items: ${blockedAdminMenuLabels.join(', ')}`
              : undefined,
        })
        continue
      }

      const admissionFailure = validatePluginAdmission(manifest, manifests, trustedPlugin, undefined, claimedRouteNames)
      if (admissionFailure) {
        this.loadedPlugins.push({
          name: manifest.name,
          enabled: true,
          hooks: [],
          aiTools: [],
          routes: [],
          adminRoutes: [],
          publicRoutes: [],
          status: 'blocked',
          sandbox: 'trusted_catalog',
          adminMenu: [],
          reason: admissionFailure.reason,
          rejectionCode: admissionFailure.rejectionCode,
        })
        continue
      }
      if (!trustedPlugin) continue


      for (const [hookName, hook] of Object.entries(trustedPlugin.hooks)) {
        if (!hook) continue
        this.registry.register(hookName as HookName, hook)
      }
      for (const aiTool of trustedPlugin.aiTools ?? []) {
        if (loadedToolNames.has(aiTool.name)) continue
        this.loadedPluginAiTools.push({
          ...aiTool,
          toCommands: (args) => {
            const safeArgs = deepFreeze(cloneForSandbox(args))
            const rawCommands = aiTool.toCommands(safeArgs)
            return sanitizeToolCommands(rawCommands)
          },
        })
        loadedToolNames.add(aiTool.name)
      }
      for (const field of trustedPlugin.fields ?? []) {
        this.loadedPluginFields.push({ ...field })
      }
      const loadedRouteNames: string[] = []
      const loadedAdminRouteNames: string[] = []
      const loadedPublicRouteNames: string[] = []
      const blockedRouteNames: string[] = []
      const { adminMenu, blockedAdminMenuLabels } = getTrustedAdminMenu(
        manifest.name,
        trustedPlugin
      )
      for (const [routeName, routeFactory] of Object.entries(trustedPlugin.routes ?? {})) {
        let routePaths: string[]
        try {
          const probeApp = routeFactory() as AnyElysia
          routePaths = getRoutePaths(probeApp)
        } catch {
          blockedRouteNames.push(routeName)
          continue
        }

        const routeKinds = routePaths.map((path) =>
          getSandboxedPluginRouteKind(manifest.name, path)
        )
        const isSandboxed =
          routeKinds.length > 0 && routeKinds.every((kind) => kind === 'admin')

        if (!isSandboxed) {
          blockedRouteNames.push(routeName)
          continue
        }

        loadedRouteNames.push(routeName)
        claimedRouteNames.add(routeName)
        if (routeKinds.includes('admin')) loadedAdminRouteNames.push(routeName)
        this.loadedPluginRoutes.push({
          pluginName: manifest.name,
          routeName,
          createRoute: routeFactory,
        })
      }

      this.loadedPlugins.push({
        name: manifest.name,
        enabled: true,
        hooks: Object.keys(trustedPlugin.hooks) as HookName[],
        aiTools: trustedPlugin.aiTools?.map((tool) => tool.name) ?? [],
        routes: loadedRouteNames,
        adminRoutes: loadedAdminRouteNames,
        publicRoutes: loadedPublicRouteNames,
        status: 'loaded',
        sandbox: 'trusted_catalog',
        metadata: trustedPlugin.metadata ? { ...trustedPlugin.metadata } : undefined,
        adminMenu,
        reason:
          blockedRouteNames.length > 0 || blockedAdminMenuLabels.length > 0
            ? [
                blockedRouteNames.length > 0
                  ? `Blocked unsandboxed plugin routes: ${blockedRouteNames.join(', ')}`
                  : undefined,
                blockedAdminMenuLabels.length > 0
                  ? `Blocked unsafe plugin admin menu items: ${blockedAdminMenuLabels.join(', ')}`
                  : undefined,
              ]
                .filter(Boolean)
                .join('; ')
            : undefined,
      })
    }

    return this.registry
  }

  async loadPlugins(
    manifests: PluginManifest[],
    trustedPluginResolver: (name: string) => TrustedPluginDefinition | undefined = getTrustedPluginDefinition,
    options: PluginLoadOptions = {}
  ): Promise<PluginRegistry> {
    if (!options.kv) {
      return this.loadPluginsSync(manifests, trustedPluginResolver)
    }
    const currentHookTimeoutMs = this.registry.getHookTimeoutMs()
    this.registry.clear()
    this.registry.setHookTimeoutMs(currentHookTimeoutMs)
    this.loadedPlugins = []
    this.loadedPluginAiTools = []
    this.loadedPluginFields = []
    this.loadedPluginRoutes = []
    const loadedToolNames = new Set<string>()
    const claimedRouteNames = new Set<string>()

    for (const manifest of manifests) {
      const enabled =
        manifest.enabled !== false &&
        (options.kv ? await this.registry.isPluginEnabled(options.kv, manifest.name) : true)
      const trustedPlugin = trustedPluginResolver(manifest.name)

      if (!enabled) {
        const { adminMenu, blockedAdminMenuLabels } = getTrustedAdminMenu(
          manifest.name,
          trustedPlugin
        )
        this.loadedPlugins.push({
          name: manifest.name,
          enabled: false,
          hooks: trustedPlugin ? (Object.keys(trustedPlugin.hooks) as HookName[]) : [],
          aiTools: trustedPlugin?.aiTools?.map((tool) => tool.name) ?? [],
          routes: Object.keys(trustedPlugin?.routes ?? {}),
          adminRoutes: [],
          publicRoutes: [],
          status: 'disabled',
          sandbox: 'trusted_catalog',
          metadata: trustedPlugin?.metadata ? { ...trustedPlugin.metadata } : undefined,
          adminMenu,
          reason:
            blockedAdminMenuLabels.length > 0
              ? `Blocked unsafe plugin admin menu items: ${blockedAdminMenuLabels.join(', ')}`
              : undefined,
        })
        continue
      }

      const admissionFailure = validatePluginAdmission(
        manifest,
        manifests,
        trustedPlugin,
        options.kv ? { CACHE: options.kv } : undefined,
        claimedRouteNames
      )
      if (admissionFailure) {
        this.loadedPlugins.push({
          name: manifest.name,
          enabled: true,
          hooks: [],
          aiTools: [],
          routes: [],
          adminRoutes: [],
          publicRoutes: [],
          status: 'blocked',
          sandbox: 'trusted_catalog',
          adminMenu: [],
          reason: admissionFailure.reason,
          rejectionCode: admissionFailure.rejectionCode,
        })
        continue
      }
      if (!trustedPlugin) continue


      for (const [hookName, hook] of Object.entries(trustedPlugin.hooks)) {
        if (!hook) continue
        this.registry.register(hookName as HookName, hook)
      }
      for (const aiTool of trustedPlugin.aiTools ?? []) {
        if (loadedToolNames.has(aiTool.name)) continue
        this.loadedPluginAiTools.push({
          ...aiTool,
          toCommands: (args) => {
            const safeArgs = deepFreeze(cloneForSandbox(args))
            const rawCommands = aiTool.toCommands(safeArgs)
            return sanitizeToolCommands(rawCommands)
          },
        })
        loadedToolNames.add(aiTool.name)
      }
      for (const field of trustedPlugin.fields ?? []) {
        this.loadedPluginFields.push({ ...field })
      }
      const loadedRouteNames: string[] = []
      const loadedAdminRouteNames: string[] = []
      const loadedPublicRouteNames: string[] = []
      const blockedRouteNames: string[] = []
      const { adminMenu, blockedAdminMenuLabels } = getTrustedAdminMenu(
        manifest.name,
        trustedPlugin
      )
      for (const [routeName, routeFactory] of Object.entries(trustedPlugin.routes ?? {})) {
        let routePaths: string[]
        try {
          const probeApp = routeFactory() as AnyElysia
          routePaths = getRoutePaths(probeApp)
        } catch {
          blockedRouteNames.push(routeName)
          continue
        }
        const routeKinds = routePaths.map((path) =>
          getSandboxedPluginRouteKind(manifest.name, path)
        )
        const isSandboxed =
          routeKinds.length > 0 && routeKinds.every((kind) => kind === 'admin')

        if (!isSandboxed) {
          blockedRouteNames.push(routeName)
          continue
        }

        loadedRouteNames.push(routeName)
        claimedRouteNames.add(routeName)
        if (routeKinds.includes('admin')) loadedAdminRouteNames.push(routeName)
        this.loadedPluginRoutes.push({
          pluginName: manifest.name,
          routeName,
          createRoute: routeFactory,
        })
      }

      this.loadedPlugins.push({
        name: manifest.name,
        enabled: true,
        hooks: Object.keys(trustedPlugin.hooks) as HookName[],
        aiTools: trustedPlugin.aiTools?.map((tool) => tool.name) ?? [],
        routes: loadedRouteNames,
        adminRoutes: loadedAdminRouteNames,
        publicRoutes: loadedPublicRouteNames,
        status: 'loaded',
        sandbox: 'trusted_catalog',
        metadata: trustedPlugin.metadata ? { ...trustedPlugin.metadata } : undefined,
        adminMenu,
        reason:
          blockedRouteNames.length > 0 || blockedAdminMenuLabels.length > 0
            ? [
                blockedRouteNames.length > 0
                  ? `Blocked unsandboxed plugin routes: ${blockedRouteNames.join(', ')}`
                  : undefined,
                blockedAdminMenuLabels.length > 0
                  ? `Blocked unsafe plugin admin menu items: ${blockedAdminMenuLabels.join(', ')}`
                  : undefined,
              ]
                .filter(Boolean)
                .join('; ')
            : undefined,
      })
    }

    return this.registry
  }

  async reloadConfiguredPlugins(
    rawConfig: string | undefined,
    options: PluginLoadOptions = {}
  ): Promise<PluginRegistry> {
    return this.loadPlugins(parsePluginConfig(rawConfig), getTrustedPluginDefinition, options)
  }
}

const registryRuntimeMap = new WeakMap<PluginRegistry, PluginRuntime>()

export function createPluginRuntime(registry?: PluginRegistry): PluginRuntime {
  return new PluginRuntime(registry)
}

export const defaultPluginRuntime = createPluginRuntime(pluginRegistry)
let lastActivePluginRuntime: PluginRuntime = defaultPluginRuntime

export function getPluginRuntimeForRegistry(registry: PluginRegistry): PluginRuntime {
  let runtime = registryRuntimeMap.get(registry)
  if (!runtime) {
    runtime = createPluginRuntime(registry)
    registryRuntimeMap.set(registry, runtime)
  }
  return runtime
}

export async function loadPlugins(
  manifests: PluginManifest[],
  registry: PluginRegistry = defaultPluginRuntime.registry,
  trustedPluginResolver: (name: string) => TrustedPluginDefinition | undefined = getTrustedPluginDefinition,
  options: PluginLoadOptions = {}
): Promise<PluginRegistry> {
  const runtime = getPluginRuntimeForRegistry(registry)
  lastActivePluginRuntime = runtime
  return runtime.loadPlugins(manifests, trustedPluginResolver, options)
}

export async function reloadConfiguredPlugins(
  rawConfig: string | undefined,
  registry: PluginRegistry = defaultPluginRuntime.registry,
  options: PluginLoadOptions = {}
): Promise<PluginRegistry> {
  const runtime = getPluginRuntimeForRegistry(registry)
  lastActivePluginRuntime = runtime
  return runtime.reloadConfiguredPlugins(rawConfig, options)
}

export function loadConfiguredPluginsSync(
  rawConfig: string | undefined,
  runtime: PluginRuntime = defaultPluginRuntime
): PluginRegistry {
  lastActivePluginRuntime = runtime
  return runtime.loadPluginsSync(parsePluginConfig(rawConfig))
}

export function getLoadedPlugins(runtime?: PluginRuntime): LoadedPluginMetadata[] {
  return (runtime ?? lastActivePluginRuntime).getLoadedPlugins()
}

export function getLoadedPluginAiTools(runtime?: PluginRuntime): TrustedPluginAiTool[] {
  return (runtime ?? lastActivePluginRuntime).getLoadedPluginAiTools()
}

export function getLoadedPluginFields(runtime?: PluginRuntime): TrustedPluginFieldType[] {
  return (runtime ?? lastActivePluginRuntime).getLoadedPluginFields()
}

export function createLoadedPluginRoutesController(runtime?: PluginRuntime): AnyElysia {
  return (runtime ?? lastActivePluginRuntime).createLoadedPluginRoutesController()
}

export function clearLoadedPlugins(runtime?: PluginRuntime): void {
  (runtime ?? lastActivePluginRuntime).clear()
}

export function createPluginRegistry(initialTimeoutMs?: number): PluginRegistry {
  const reg = createDefaultRegistry()
  if (typeof initialTimeoutMs === 'number' && typeof reg.setHookTimeoutMs === 'function') {
    reg.setHookTimeoutMs(initialTimeoutMs)
  }
  return reg
}

