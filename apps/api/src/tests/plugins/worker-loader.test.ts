import { describe, expect, it, vi } from 'bun:test'
import {
  VALID_PLUGIN_CAPABILITIES,
  validatePluginCapabilities,
  sanitizePluginEnvironment,
  UntrustedPluginSandboxAdapter,
  PluginCapabilityError,
} from '@/plugins/worker-loader'
import { validatePluginAdmission, parsePluginConfig } from '@/plugins/plugin-loader'
import type { PluginManifest } from '@edgecms/plugin-sdk'
import type { CommandEnvelope } from '@edgecms/schemas/commands'

describe('Untrusted Plugin Sandboxing via Dynamic Worker Loaders (C-15)', () => {
  describe('Capability Validation', () => {
    it('recognizes all supported plugin capabilities', () => {
      expect(VALID_PLUGIN_CAPABILITIES.has('content:read')).toBe(true)
      expect(VALID_PLUGIN_CAPABILITIES.has('content:write')).toBe(true)
      expect(VALID_PLUGIN_CAPABILITIES.has('media:read')).toBe(true)
      expect(VALID_PLUGIN_CAPABILITIES.has('media:write')).toBe(true)
      expect(VALID_PLUGIN_CAPABILITIES.has('network:fetch')).toBe(true)
      expect(VALID_PLUGIN_CAPABILITIES.size).toBe(5)
    })

    it('approves valid capability sets', () => {
      const res = validatePluginCapabilities(['content:read', 'network:fetch'])
      expect(res.valid).toBe(true)
      expect(res.invalidCapabilities).toHaveLength(0)
    })

    it('rejects unauthorized or arbitrary capability strings', () => {
      const res = validatePluginCapabilities(['content:read', 'database:raw_admin', 'exec:shell'])
      expect(res.valid).toBe(false)
      expect(res.invalidCapabilities).toContain('database:raw_admin')
      expect(res.invalidCapabilities).toContain('exec:shell')
    })
  })

  describe('Environment Sanitization', () => {
    it('strips direct database handles, API keys, and sensitive secrets', () => {
      const mockD1 = { prepare: () => ({}) }
      const rawEnv = {
        DB: mockD1,
        BETTER_AUTH_SECRET: 'super-secret-key-that-must-never-leak',
        EDGECMS_API_KEY: 'admin-key-1234',
        CF_API_TOKEN: 'cf-secret-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account-id',
        CUSTOM_PASSWORD: 'plain-text-pwd',
        PUBLIC_SITE_NAME: 'My Edge CMS Site',
        PUBLIC_URL: 'https://example.com',
      }

      const sanitized = sanitizePluginEnvironment(rawEnv)

      expect(sanitized.DB).toBeUndefined()
      expect(sanitized.BETTER_AUTH_SECRET).toBeUndefined()
      expect(sanitized.EDGECMS_API_KEY).toBeUndefined()
      expect(sanitized.CF_API_TOKEN).toBeUndefined()
      expect(sanitized.CLOUDFLARE_ACCOUNT_ID).toBeUndefined()
      expect(sanitized.CUSTOM_PASSWORD).toBeUndefined()

      expect(sanitized.PUBLIC_SITE_NAME).toBe('My Edge CMS Site')
      expect(sanitized.PUBLIC_URL).toBe('https://example.com')
      expect(Object.isFrozen(sanitized)).toBe(true)
    })
  })

  describe('UntrustedPluginSandboxAdapter Execution Scope', () => {
    it('enforces content:read capability', async () => {
      const contentReader = vi.fn().mockResolvedValue({ id: 'entry-1', title: 'Hello' })

      // 1. Without content:read capability
      const unprivilegedSandbox = new UntrustedPluginSandboxAdapter({
        pluginName: 'unprivileged-plugin',
        capabilities: [],
        contentReader,
      })
      const unprivilegedScope = unprivilegedSandbox.createScope()

      await expect(unprivilegedScope.readContent('posts', 'entry-1')).rejects.toThrow(PluginCapabilityError)
      expect(contentReader).not.toHaveBeenCalled()

      // 2. With content:read capability
      const privilegedSandbox = new UntrustedPluginSandboxAdapter({
        pluginName: 'content-reader-plugin',
        capabilities: ['content:read'],
        contentReader,
      })
      const privilegedScope = privilegedSandbox.createScope()

      const result = await privilegedScope.readContent('posts', 'entry-1')
      expect(result).toEqual({ id: 'entry-1', title: 'Hello' })
      expect(contentReader).toHaveBeenCalledWith('posts', 'entry-1')
    })

    it('enforces content:write capability on command emission', async () => {
      const commandEmitter = vi.fn().mockResolvedValue(undefined)
      const testCmd: CommandEnvelope = {
        type: 'createEntry',
        payload: { title: 'New Article' },
        actor: { userId: 'plugin-bot', source: 'ai' },
        timestamp: new Date().toISOString(),
      }

      // 1. Without content:write
      const readOnlySandbox = new UntrustedPluginSandboxAdapter({
        pluginName: 'readonly-plugin',
        capabilities: ['content:read'],
        commandEmitter,
      })
      await expect(readOnlySandbox.createScope().emitCommand(testCmd)).rejects.toThrow(PluginCapabilityError)

      // 2. With content:write
      const writeSandbox = new UntrustedPluginSandboxAdapter({
        pluginName: 'writer-plugin',
        capabilities: ['content:write'],
        commandEmitter,
      })
      await writeSandbox.createScope().emitCommand(testCmd)
      expect(commandEmitter).toHaveBeenCalledWith(testCmd)
    })

    it('enforces media:read and media:write capabilities', async () => {
      const mediaReader = vi.fn().mockResolvedValue({ id: 'asset-1' })
      const mediaWriter = vi.fn().mockResolvedValue({ assetId: 'asset-created' })

      const sandbox = new UntrustedPluginSandboxAdapter({
        pluginName: 'media-test',
        capabilities: ['media:read'],
        mediaReader,
        mediaWriter,
      })
      const scope = sandbox.createScope()

      // media:read succeeds
      const media = await scope.readMedia('asset-1')
      expect(media).toEqual({ id: 'asset-1' })

      // media:write fails
      await expect(
        scope.writeMedia('file.png', new Uint8Array([1, 2, 3]), 'image/png')
      ).rejects.toThrow(PluginCapabilityError)
    })

    it('enforces network:fetch capability and blocks SSRF targets', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('OK'))

      // 1. Without network:fetch
      const offlineSandbox = new UntrustedPluginSandboxAdapter({
        pluginName: 'offline-plugin',
        capabilities: [],
        fetchProvider: mockFetch as any,
      })
      await expect(offlineSandbox.createScope().safeFetch('https://api.example.com/data')).rejects.toThrow(
        PluginCapabilityError
      )

      // 2. With network:fetch but targeting loopback / private IP (SSRF)
      const onlineSandbox = new UntrustedPluginSandboxAdapter({
        pluginName: 'online-plugin',
        capabilities: ['network:fetch'],
        fetchProvider: mockFetch as any,
      })
      const onlineScope = onlineSandbox.createScope()

      await expect(onlineScope.safeFetch('http://127.0.0.1:8787/secret')).rejects.toThrow(
        /Access to private or local network address/
      )
      await expect(onlineScope.safeFetch('http://127.0.0.2/secret')).rejects.toThrow(
        /Access to private or local network address/
      )
      await expect(onlineScope.safeFetch('http://192.168.1.1/admin')).rejects.toThrow(
        /Access to private or local network address/
      )
      await expect(onlineScope.safeFetch('http://10.0.0.1/internal')).rejects.toThrow(
        /Access to private or local network address/
      )
      await expect(onlineScope.safeFetch('http://172.16.0.1/docker')).rejects.toThrow(
        /Access to private or local network address/
      )
      await expect(onlineScope.safeFetch('http://[::1]/secret')).rejects.toThrow(
        /Access to private or local network address/
      )
      await expect(onlineScope.safeFetch('http://[fe80::1]/link-local')).rejects.toThrow(
        /Access to private or local network address/
      )
      await expect(onlineScope.safeFetch('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
        /Access to private or local network address/
      )
      await expect(onlineScope.safeFetch('http://localhost:3000/api')).rejects.toThrow(
        /Access to private or local network address/
      )

      // 3. Legitimate external fetch succeeds
      const response = await onlineScope.safeFetch('https://api.weather.com/v1/forecast')
      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('runs hooks within sandbox and handles timeout', async () => {
      const sandbox = new UntrustedPluginSandboxAdapter({
        pluginName: 'timeout-plugin',
        capabilities: ['content:read'],
        timeoutMs: 50,
      })

      // Fast hook succeeds
      await sandbox.runHook(async (_ctx, scope) => {
        expect(scope.pluginName).toBe('timeout-plugin')
      }, {
        requestId: 'req-1',
        pathname: '/api',
        method: 'GET',
      })

      // Hanging hook times out
      await expect(
        sandbox.runHook(async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }, {
          requestId: 'req-2',
          pathname: '/api',
          method: 'GET',
        })
      ).rejects.toThrow(/hook execution timed out/)
    })
  })

  describe('Plugin Admission Integration', () => {
    it('rejects plugins with UNAUTHORIZED_CAPABILITY in validatePluginAdmission', () => {
      const fakeTrusted = { hooks: {} } as any
      const manifestWithBadCap: PluginManifest = {
        name: 'bad-plugin',
        capabilities: ['content:read', 'arbitrary:admin' as any],
      }

      const admissionFailure = validatePluginAdmission(manifestWithBadCap, [manifestWithBadCap], fakeTrusted)
      expect(admissionFailure).not.toBeNull()
      expect(admissionFailure?.rejectionCode).toBe('UNAUTHORIZED_CAPABILITY')
      expect(admissionFailure?.reason).toContain('arbitrary:admin')
    })

    it('admits plugins with valid capabilities', () => {
      const fakeTrusted = { hooks: {} } as any
      const validManifest: PluginManifest = {
        name: 'good-plugin',
        capabilities: ['content:read', 'network:fetch'],
      }

      const admissionFailure = validatePluginAdmission(validManifest, [validManifest], fakeTrusted)
      expect(admissionFailure).toBeNull()
    })

    it('parses capabilities correctly from JSON plugin config in parsePluginConfig', () => {
      const rawConfig = JSON.stringify([
        {
          name: 'configured-plugin',
          enabled: true,
          capabilities: ['content:read', 'media:write'],
        },
      ])

      const manifests = parsePluginConfig(rawConfig)
      expect(manifests).toHaveLength(1)
      expect(manifests[0]?.capabilities).toEqual(['content:read', 'media:write'])
    })
  })
})
