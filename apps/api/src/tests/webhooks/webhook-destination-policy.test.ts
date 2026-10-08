import { describe, expect, it } from 'bun:test'
import {
  parseAllowedWebhookHosts,
  validateWebhookDestination,
} from '../../webhooks/webhook-destination-policy'

describe('webhook-destination-policy', () => {
  // ==========================================================================
  // validateWebhookDestination
  // ==========================================================================
  describe('validateWebhookDestination', () => {
    // -----------------------------------------------------------------------
    // Valid URLs
    // -----------------------------------------------------------------------
    describe('valid destinations', () => {
      it('accepts a valid HTTPS URL', () => {
        const result = validateWebhookDestination('https://example.com/webhook')
        expect(result).toEqual({ valid: true })
      })

      it('accepts a valid HTTPS URL with path and query', () => {
        const result = validateWebhookDestination(
          'https://hooks.example.com/receive?token=abc123'
        )
        expect(result).toEqual({ valid: true })
      })

      it('accepts HTTPS on port 443 explicitly', () => {
        const result = validateWebhookDestination('https://example.com:443/webhook')
        expect(result).toEqual({ valid: true })
      })

      it('accepts public IPv4 addresses over HTTPS', () => {
        const result = validateWebhookDestination('https://203.0.113.50/webhook')
        expect(result).toEqual({ valid: true })
      })

      it('accepts subdomain URLs', () => {
        const result = validateWebhookDestination('https://api.hooks.example.com/v1/webhook')
        expect(result).toEqual({ valid: true })
      })
    })

    // -----------------------------------------------------------------------
    // Protocol checks
    // -----------------------------------------------------------------------
    describe('protocol validation', () => {
      it('rejects HTTP URLs', () => {
        const result = validateWebhookDestination('http://example.com/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('HTTPS')
        }
      })

      it('rejects FTP URLs', () => {
        const result = validateWebhookDestination('ftp://example.com/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('HTTPS')
        }
      })
    })

    // -----------------------------------------------------------------------
    // URL format
    // -----------------------------------------------------------------------
    describe('URL format validation', () => {
      it('rejects invalid URL format', () => {
        const result = validateWebhookDestination('not-a-url')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('Invalid URL')
        }
      })

      it('rejects empty string', () => {
        const result = validateWebhookDestination('')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('Invalid URL')
        }
      })
    })

    // -----------------------------------------------------------------------
    // Credentials
    // -----------------------------------------------------------------------
    describe('embedded credentials', () => {
      it('rejects URLs with username and password', () => {
        const result = validateWebhookDestination('https://user:pass@example.com/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('credentials')
        }
      })

      it('rejects URLs with only username', () => {
        const result = validateWebhookDestination('https://user@example.com/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('credentials')
        }
      })
    })

    // -----------------------------------------------------------------------
    // Port checks
    // -----------------------------------------------------------------------
    describe('port validation', () => {
      it('rejects non-standard HTTPS ports', () => {
        const result = validateWebhookDestination('https://example.com:8443/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('port')
        }
      })

      it('rejects port 80', () => {
        const result = validateWebhookDestination('https://example.com:80/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('port')
        }
      })

      it('accepts default port (no port specified)', () => {
        const result = validateWebhookDestination('https://example.com/webhook')
        expect(result).toEqual({ valid: true })
      })
    })

    // -----------------------------------------------------------------------
    // Private / Local hosts — IPv4
    // -----------------------------------------------------------------------
    describe('private IPv4 addresses', () => {
      it('rejects localhost (127.0.0.1)', () => {
        const result = validateWebhookDestination('https://127.0.0.1/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects 127.x.x.x range', () => {
        const result = validateWebhookDestination('https://127.0.0.2/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects 10.x.x.x private range', () => {
        const result = validateWebhookDestination('https://10.0.0.1/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects 192.168.x.x private range', () => {
        const result = validateWebhookDestination('https://192.168.1.1/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects 172.16-31.x.x private range', () => {
        const blocked = [
          'https://172.16.0.1/webhook',
          'https://172.20.0.1/webhook',
          'https://172.31.255.255/webhook',
        ]
        for (const url of blocked) {
          const result = validateWebhookDestination(url)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            expect(result.error).toContain('private network')
          }
        }
      })

      it('rejects link-local 169.254.x.x', () => {
        const result = validateWebhookDestination('https://169.254.1.1/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })
    })

    // -----------------------------------------------------------------------
    // Private / Local hosts — IPv6
    // -----------------------------------------------------------------------
    describe('private IPv6 addresses', () => {
      it('rejects ::1 (IPv6 loopback)', () => {
        const result = validateWebhookDestination('https://[::1]/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects fc00::/7 unique local addresses', () => {
        const blocked = [
          'https://[fc00::1]/webhook',
          'https://[fd12:3456:789a::1]/webhook',
        ]
        for (const url of blocked) {
          const result = validateWebhookDestination(url)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            expect(result.error).toContain('private network')
          }
        }
      })

      it('rejects fe80:: link-local addresses', () => {
        const result = validateWebhookDestination('https://[fe80::1]/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects IPv4-mapped IPv6 loopback addresses', () => {
        const result = validateWebhookDestination('https://[::ffff:127.0.0.1]/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects IPv4-mapped private IPv6 addresses', () => {
        const blocked = [
          'https://[::ffff:10.0.0.1]/webhook',
          'https://[::ffff:192.168.1.5]/webhook',
          'https://[::ffff:172.16.0.10]/webhook',
          'https://[::ffff:169.254.1.1]/webhook',
        ]
        for (const url of blocked) {
          const result = validateWebhookDestination(url)
          expect(result.valid).toBe(false)
          if (!result.valid) {
            expect(result.error).toContain('private network')
          }
        }
      })
    })

    // -----------------------------------------------------------------------
    // Local hostnames
    // -----------------------------------------------------------------------
    describe('local hostnames', () => {
      it('rejects localhost hostname', () => {
        const result = validateWebhookDestination('https://localhost/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects .local domains', () => {
        const result = validateWebhookDestination('https://myhost.local/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })

      it('rejects .internal domains', () => {
        const result = validateWebhookDestination('https://service.internal/webhook')
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('private network')
        }
      })
    })

    // -----------------------------------------------------------------------
    // Allowed hosts policy
    // -----------------------------------------------------------------------
    describe('allowed hosts policy', () => {
      it('allows URL when no policy is specified', () => {
        const result = validateWebhookDestination('https://any-domain.com/webhook')
        expect(result).toEqual({ valid: true })
      })

      it('allows URL when host matches allowed list', () => {
        const result = validateWebhookDestination('https://example.com/webhook', {
          allowedHosts: ['example.com'],
        })
        expect(result).toEqual({ valid: true })
      })

      it('allows subdomain when parent domain is in allowed list', () => {
        const result = validateWebhookDestination('https://hooks.example.com/webhook', {
          allowedHosts: ['example.com'],
        })
        expect(result).toEqual({ valid: true })
      })

      it('allows URL when wildcard host matches', () => {
        const result = validateWebhookDestination('https://api.example.com/webhook', {
          allowedHosts: ['*.example.com'],
        })
        expect(result).toEqual({ valid: true })
      })

      it('rejects URL when host is not in allowed list', () => {
        const result = validateWebhookDestination('https://evil.net/webhook', {
          allowedHosts: ['example.com'],
        })
        expect(result.valid).toBe(false)
        if (!result.valid) {
          expect(result.error).toContain('allowed host')
        }
      })

      it('allows any host when allowedHosts is empty array', () => {
        const result = validateWebhookDestination('https://any-domain.com/webhook', {
          allowedHosts: [],
        })
        expect(result).toEqual({ valid: true })
      })

      it('performs case-insensitive host matching', () => {
        const result = validateWebhookDestination('https://EXAMPLE.COM/webhook', {
          allowedHosts: ['example.com'],
        })
        expect(result).toEqual({ valid: true })
      })
    })
  })

  // ==========================================================================
  // parseAllowedWebhookHosts
  // ==========================================================================
  describe('parseAllowedWebhookHosts', () => {
    it('returns empty array for undefined input', () => {
      expect(parseAllowedWebhookHosts(undefined)).toEqual([])
    })

    it('returns empty array for empty string', () => {
      expect(parseAllowedWebhookHosts('')).toEqual([])
    })

    it('parses single host', () => {
      const result = parseAllowedWebhookHosts('example.com')
      expect(result).toEqual(['example.com'])
    })

    it('parses comma-separated hosts', () => {
      const result = parseAllowedWebhookHosts('example.com,hooks.io,api.dev')
      expect(result).toHaveLength(3)
      expect(result).toContain('example.com')
      expect(result).toContain('hooks.io')
      expect(result).toContain('api.dev')
    })

    it('trims whitespace from entries', () => {
      const result = parseAllowedWebhookHosts(' example.com , hooks.io ')
      expect(result).toEqual(['example.com', 'hooks.io'])
    })

    it('filters out empty entries', () => {
      const result = parseAllowedWebhookHosts('example.com,,hooks.io,')
      expect(result).toEqual(['example.com', 'hooks.io'])
    })

    it('normalizes hosts to lowercase', () => {
      const result = parseAllowedWebhookHosts('EXAMPLE.COM,Hooks.IO')
      expect(result).toEqual(['example.com', 'hooks.io'])
    })

    it('handles wildcard hosts by stripping *. prefix', () => {
      const result = parseAllowedWebhookHosts('*.example.com')
      expect(result).toEqual(['example.com'])
    })

    it('handles mixed wildcard and plain hosts', () => {
      const result = parseAllowedWebhookHosts('*.example.com,hooks.io')
      expect(result).toEqual(['example.com', 'hooks.io'])
    })
  })
})
