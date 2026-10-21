import { describe, expect, it, vi } from 'bun:test'
import {
  defaultCanCreateTenant,
  resolveHostPolicies,
  type TenantCreationActor,
} from '../../host/host-policies'
import { createTenantEventPublisher, tenantStatusTransitionEvent } from '../../host/tenant-events'

const actor = (overrides: Partial<TenantCreationActor> = {}): TenantCreationActor => ({
  userId: 'u1',
  email: 'a@example.com',
  isSuperAdmin: false,
  source: 'admin-api',
  ...overrides,
})

const tenant = { id: 't1', slug: 'acme', name: 'Acme', status: 'active' }

describe('host policies', () => {
  it('default canCreateTenant keeps today behavior', () => {
    expect(defaultCanCreateTenant(actor())).toBe(false)
    expect(defaultCanCreateTenant(actor({ isSuperAdmin: true }))).toBe(true)
    expect(defaultCanCreateTenant(actor({ source: 'onboarding' }))).toBe(true)
  })

  it('normalizes host decisions', async () => {
    const decide = async (value: unknown) =>
      resolveHostPolicies({ canCreateTenant: () => value as boolean }).canCreateTenant(actor())

    expect(await decide(true)).toEqual({ allowed: true, initialStatus: 'active' })
    expect(await decide(false)).toEqual({ allowed: false })
    expect(await decide({ allowed: true, initialStatus: 'pending' })).toEqual({
      allowed: true,
      initialStatus: 'pending',
    })
    // Anything other than a known initial status falls back to active.
    expect(await decide({ allowed: true, initialStatus: 'suspended' })).toEqual({
      allowed: true,
      initialStatus: 'active',
    })
    expect(await decide({ allowed: false, reason: 'quota' })).toEqual({
      allowed: false,
      reason: 'quota',
    })
    expect(await decide(undefined)).toEqual({ allowed: false })
  })

  it('fails closed when the host policy throws or rejects', async () => {
    const throwing = resolveHostPolicies({
      canCreateTenant: () => {
        throw new Error('down')
      },
    })
    const rejecting = resolveHostPolicies({ canCreateTenant: async () => Promise.reject(new Error('down')) })

    expect(await throwing.canCreateTenant(actor({ isSuperAdmin: true }))).toEqual({ allowed: false })
    expect(await rejecting.canCreateTenant(actor({ isSuperAdmin: true }))).toEqual({ allowed: false })
  })

  it('keeps separate app instances independent', async () => {
    const open = resolveHostPolicies({ canCreateTenant: () => true })
    const closed = resolveHostPolicies()

    expect((await open.canCreateTenant(actor())).allowed).toBe(true)
    expect((await closed.canCreateTenant(actor())).allowed).toBe(false)
  })
})

describe('tenant event publisher', () => {
  it('maps status transitions to lifecycle events', () => {
    expect(tenantStatusTransitionEvent('pending', 'active')).toBe('tenant.activated')
    expect(tenantStatusTransitionEvent('active', 'suspended')).toBe('tenant.suspended')
    expect(tenantStatusTransitionEvent('active', 'disabled')).toBeNull()
    expect(tenantStatusTransitionEvent('suspended', 'suspended')).toBeNull()
  })

  it('emits to the event bus with global webhook scope and to the host listener', async () => {
    const emit = vi.fn(async () => undefined)
    const onTenantEvent = vi.fn()
    const publisher = createTenantEventPublisher({ onTenantEvent }, { emit })

    await publisher.publish('tenant.suspended', { ...tenant, status: 'suspended' }, {
      previousStatus: 'active',
      actorId: 'u1',
    })

    expect(emit).toHaveBeenCalledWith('tenant.suspended', {
      after: { id: 't1', slug: 'acme', name: 'Acme', status: 'suspended' },
      metadata: {
        syncChannel: 'global',
        tenantId: 't1',
        previousStatus: 'active',
        actorId: 'u1',
      },
    }, { mode: 'sync' })
    expect(onTenantEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tenant.suspended',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', status: 'suspended' },
        previousStatus: 'active',
        actorId: 'u1',
      })
    )
  })

  it('does not leak extra tenant row fields into events', async () => {
    const emit = vi.fn(async () => undefined)
    const onTenantEvent = vi.fn()
    const publisher = createTenantEventPublisher({ onTenantEvent }, { emit })

    await publisher.publish('tenant.created', { ...tenant, corsOrigin: 'https://x.test' } as typeof tenant)

    const hostPayload = onTenantEvent.mock.calls[0]?.[0] as { tenant: Record<string, unknown> }
    expect(Object.keys(hostPayload.tenant).sort()).toEqual(['id', 'name', 'slug', 'status'])
  })

  it('isolates listener and bus failures from the caller', async () => {
    const publisher = createTenantEventPublisher(
      {
        onTenantEvent: () => {
          throw new Error('host down')
        },
      },
      { emit: async () => Promise.reject(new Error('bus down')) }
    )

    await expect(publisher.publish('tenant.deleted', tenant)).resolves.toBeUndefined()
  })
})
