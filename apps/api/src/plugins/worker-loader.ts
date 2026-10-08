import type { PluginCapability, PluginHookContext } from '@edgecms/plugin-sdk'
import type { CommandEnvelope } from '@edgecms/schemas/commands'

export const VALID_PLUGIN_CAPABILITIES: ReadonlySet<PluginCapability> = new Set([
  'content:read',
  'content:write',
  'media:read',
  'media:write',
  'network:fetch',
])

const SENSITIVE_KEY_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /key/i,
  /^db$/i,
  /^cf_api/i,
  /^cloudflare_account/i,
]

export class PluginCapabilityError extends Error {
  readonly capability: PluginCapability
  readonly pluginName: string

  constructor(pluginName: string, capability: PluginCapability, action: string) {
    super(`Plugin '${pluginName}' lacks required capability '${capability}' to perform action '${action}'`)
    this.name = 'PluginCapabilityError'
    this.capability = capability
    this.pluginName = pluginName
  }
}

export type SandboxedPluginExecutionScope = {
  pluginName: string
  capabilities: ReadonlySet<PluginCapability>
  readContent: (collectionSlug: string, entryId: string) => Promise<unknown>
  emitCommand: (command: CommandEnvelope) => Promise<void>
  readMedia: (assetId: string) => Promise<unknown>
  writeMedia: (filename: string, data: ArrayBuffer | Uint8Array, mimeType: string) => Promise<{ assetId: string }>
  safeFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

export type UntrustedPluginSandboxOptions = {
  pluginName: string
  capabilities?: PluginCapability[]
  allowedHostnames?: string[]
  timeoutMs?: number
  contentReader?: (collectionSlug: string, entryId: string) => Promise<unknown>
  commandEmitter?: (command: CommandEnvelope) => Promise<void>
  mediaReader?: (assetId: string) => Promise<unknown>
  mediaWriter?: (filename: string, data: ArrayBuffer | Uint8Array, mimeType: string) => Promise<{ assetId: string }>
  fetchProvider?: typeof fetch
}

/**
 * Validates an array of capabilities declared by a plugin manifest.
 */
export function validatePluginCapabilities(capabilities?: unknown[]): {
  valid: boolean
  invalidCapabilities: string[]
} {
  if (!capabilities || !Array.isArray(capabilities)) {
    return { valid: true, invalidCapabilities: [] }
  }

  const invalidCapabilities: string[] = []
  for (const cap of capabilities) {
    if (typeof cap !== 'string' || !VALID_PLUGIN_CAPABILITIES.has(cap as PluginCapability)) {
      invalidCapabilities.push(String(cap))
    }
  }

  return {
    valid: invalidCapabilities.length === 0,
    invalidCapabilities,
  }
}

/**
 * Strips all sensitive database handles, encryption keys, and secrets from the environment
 * before exposing bindings to untrusted plugin execution scopes.
 */
export function sanitizePluginEnvironment(env: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(env)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))
    if (isSensitive) {
      continue
    }

    if (value && typeof value === 'object') {
      // Omit D1 direct handles or sensitive prototypes
      const proto = Object.getPrototypeOf(value)
      if (proto?.constructor?.name === 'D1Database' || 'prepare' in value) {
        continue
      }
    }

    sanitized[key] = value
  }

  return Object.freeze(sanitized)
}

/**
 * Untrusted Plugin Sandbox Adapter
 *
 * Implements capability-gated isolate execution for untrusted plugins:
 * - Enforces declared capabilities on all subsystem operations (content, media, network).
 * - Restricts SSRF and internal network probing.
 * - Prevents raw access to database credentials and host memory.
 */
export class UntrustedPluginSandboxAdapter {
  readonly pluginName: string
  readonly capabilities: ReadonlySet<PluginCapability>
  private readonly allowedHostnames: Set<string>
  private readonly timeoutMs: number
  private readonly contentReader?: (collectionSlug: string, entryId: string) => Promise<unknown>
  private readonly commandEmitter?: (command: CommandEnvelope) => Promise<void>
  private readonly mediaReader?: (assetId: string) => Promise<unknown>
  private readonly mediaWriter?: (filename: string, data: ArrayBuffer | Uint8Array, mimeType: string) => Promise<{ assetId: string }>
  private readonly fetchProvider: typeof fetch

  constructor(options: UntrustedPluginSandboxOptions) {
    this.pluginName = options.pluginName
    this.capabilities = new Set(options.capabilities ?? [])
    this.allowedHostnames = new Set(options.allowedHostnames ?? [])
    this.timeoutMs = options.timeoutMs ?? 5000
    this.contentReader = options.contentReader
    this.commandEmitter = options.commandEmitter
    this.mediaReader = options.mediaReader
    this.mediaWriter = options.mediaWriter
    this.fetchProvider = options.fetchProvider ?? globalThis.fetch
  }

  hasCapability(capability: PluginCapability): boolean {
    return this.capabilities.has(capability)
  }

  private assertCapability(capability: PluginCapability, action: string): void {
    if (!this.capabilities.has(capability)) {
      throw new PluginCapabilityError(this.pluginName, capability, action)
    }
  }

  private isSsrfTarget(hostname: string): boolean {
    const raw = hostname.toLowerCase().trim()
    const lower = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw

    // Hostname checks
    if (
      lower === 'localhost' ||
      lower.endsWith('.localhost') ||
      lower.endsWith('.internal') ||
      lower.endsWith('.local') ||
      lower.endsWith('.lan')
    ) {
      return true
    }

    // Decimal or hex integer representation check (e.g. 2130706433 or 0x7f000001)
    if (/^\d+$/.test(lower) || /^0x[0-9a-f]+$/i.test(lower)) {
      return true
    }

    // IPv4 loopback, unspecified, and private networks
    if (
      lower.startsWith('127.') || // Loopback (127.0.0.0/8)
      lower.startsWith('0.') ||   // Unspecified (0.0.0.0/8)
      lower.startsWith('10.') ||  // RFC 1918 Class A (10.0.0.0/8)
      lower.startsWith('192.168.') || // RFC 1918 Class C (192.168.0.0/16)
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower) || // RFC 1918 Class B (172.16.0.0/12)
      lower.startsWith('169.254.') // Link-local / Cloud metadata (169.254.0.0/16)
    ) {
      return true
    }

    // IPv6 loopback, link-local, and unique-local
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') || // Link-local
      lower.startsWith('fc00:') || // Unique local
      lower.startsWith('fd00:') || // Unique local
      lower.startsWith('::ffff:127.') || // IPv4-mapped loopback
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:192.168.') ||
      lower.startsWith('::ffff:169.254.') ||
      /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower)
    ) {
      return true
    }

    return false
  }

  /**
   * Creates the restricted execution scope provided to untrusted plugin hooks.
   */
  createScope(): SandboxedPluginExecutionScope {
    return {
      pluginName: this.pluginName,
      capabilities: this.capabilities,

      readContent: async (collectionSlug: string, entryId: string) => {
        this.assertCapability('content:read', 'readContent')
        if (!this.contentReader) {
          throw new Error(`Content reader not configured in sandbox for plugin '${this.pluginName}'`)
        }
        return this.contentReader(collectionSlug, entryId)
      },

      emitCommand: async (command: CommandEnvelope) => {
        this.assertCapability('content:write', 'emitCommand')
        if (!this.commandEmitter) {
          throw new Error(`Command emitter not configured in sandbox for plugin '${this.pluginName}'`)
        }
        return this.commandEmitter(command)
      },

      readMedia: async (assetId: string) => {
        this.assertCapability('media:read', 'readMedia')
        if (!this.mediaReader) {
          throw new Error(`Media reader not configured in sandbox for plugin '${this.pluginName}'`)
        }
        return this.mediaReader(assetId)
      },

      writeMedia: async (filename: string, data: ArrayBuffer | Uint8Array, mimeType: string) => {
        this.assertCapability('media:write', 'writeMedia')
        if (!this.mediaWriter) {
          throw new Error(`Media writer not configured in sandbox for plugin '${this.pluginName}'`)
        }
        return this.mediaWriter(filename, data, mimeType)
      },

      safeFetch: async (input: string | URL | Request, init?: RequestInit) => {
        this.assertCapability('network:fetch', 'safeFetch')

        const targetUrl =
          typeof input === 'string'
            ? new URL(input)
            : input instanceof URL
              ? input
              : new URL(input.url)

        // Block SSRF to loopback and cloud metadata endpoints
        if (this.isSsrfTarget(targetUrl.hostname) && !this.allowedHostnames.has(targetUrl.hostname)) {
          throw new Error(`Access to private or local network address '${targetUrl.hostname}' is prohibited`)
        }

        return this.fetchProvider(input, init)
      },
    }
  }

  /**
   * Runs an untrusted plugin hook inside the sandbox with timeout protection.
   */
  async runHook(
    hookFn: (ctx: PluginHookContext, scope: SandboxedPluginExecutionScope) => Promise<void> | void,
    ctx: PluginHookContext
  ): Promise<void> {
    const scope = this.createScope()

    const executionPromise = Promise.resolve().then(() => hookFn(ctx, scope))

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Plugin '${this.pluginName}' hook execution timed out after ${this.timeoutMs}ms`))
      }, this.timeoutMs)

      executionPromise.finally(() => clearTimeout(timer))
    })

    await Promise.race([executionPromise, timeoutPromise])
  }
}
