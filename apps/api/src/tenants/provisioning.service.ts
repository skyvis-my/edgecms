import type { Database } from '@/database/db'
import { logger } from '@/observability/logger'
import { tenantsRepository } from './tenants.repository'

/**
 * Cloudflare API v4 base URL.
 */
const CF_API_BASE = 'https://api.cloudflare.com/client/v4'

/**
 * Cloudflare API response structure.
 */
interface CloudflareApiResponse<T = unknown> {
  success: boolean
  errors: Array<{ code: number; message: string }>
  messages: string[]
  result: T
}

/**
 * Tenant resource IDs returned after provisioning.
 */
export interface TenantResources {
  d1DatabaseId: string
  kvNamespaceId: string
  r2BucketName: string
}

/**
 * Create headers for Cloudflare API requests.
 */
function createHeaders(apiToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Provision a D1 database for a tenant.
 *
 * @param accountId - Cloudflare account ID
 * @param tenantSlug - Tenant slug for resource naming
 * @param apiToken - Cloudflare API token with D1 create permission
 * @returns D1 database ID
 */
export async function provisionD1(
  accountId: string,
  tenantSlug: string,
  apiToken: string
): Promise<string> {
  const url = `${CF_API_BASE}/accounts/${accountId}/d1/database`
  const response = await fetch(url, {
    method: 'POST',
    headers: createHeaders(apiToken),
    body: JSON.stringify({ name: `edgecms-${tenantSlug}` }),
  })

  const data = (await response.json()) as CloudflareApiResponse<{ uuid: string }>

  if (!data.success || !data.result?.uuid) {
    const errorMsg = data.errors?.[0]?.message || 'Unknown error'
    throw new Error(`Failed to provision D1 database: ${errorMsg}`)
  }

  return data.result.uuid
}

/**
 * Provision a KV namespace for a tenant.
 *
 * @param accountId - Cloudflare account ID
 * @param tenantSlug - Tenant slug for resource naming
 * @param apiToken - Cloudflare API token with KV create permission
 * @returns KV namespace ID
 */
export async function provisionKV(
  accountId: string,
  tenantSlug: string,
  apiToken: string
): Promise<string> {
  const url = `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces`
  const response = await fetch(url, {
    method: 'POST',
    headers: createHeaders(apiToken),
    body: JSON.stringify({ title: `edgecms-${tenantSlug}` }),
  })

  const data = (await response.json()) as CloudflareApiResponse<{ id: string }>

  if (!data.success || !data.result?.id) {
    const errorMsg = data.errors?.[0]?.message || 'Unknown error'
    throw new Error(`Failed to provision KV namespace: ${errorMsg}`)
  }

  return data.result.id
}

/**
 * Provision an R2 bucket for a tenant.
 *
 * @param accountId - Cloudflare account ID
 * @param tenantSlug - Tenant slug for resource naming
 * @param apiToken - Cloudflare API token with R2 create permission
 * @returns R2 bucket name
 */
export async function provisionR2(
  accountId: string,
  tenantSlug: string,
  apiToken: string
): Promise<string> {
  const bucketName = `edgecms-${tenantSlug}`
  const url = `${CF_API_BASE}/accounts/${accountId}/r2/buckets`
  const response = await fetch(url, {
    method: 'POST',
    headers: createHeaders(apiToken),
    body: JSON.stringify({ name: bucketName }),
  })

  const data = (await response.json()) as CloudflareApiResponse<{ name: string }>

  if (!data.success || !data.result?.name) {
    const errorMsg = data.errors?.[0]?.message || 'Unknown error'
    throw new Error(`Failed to provision R2 bucket: ${errorMsg}`)
  }

  return data.result.name
}

/**
 * Run migrations against a newly provisioned D1 database.
 *
 * Executes the provided SQL statements sequentially via the Cloudflare D1 HTTP API.
 * Each migration statement is tracked in a `_migrations` table for idempotency.
 *
 * NOTE: In production, migrations should be pre-compiled into the Worker bundle
 * or managed via Wrangler CLI. This runtime approach is for automated provisioning.
 *
 * @param accountId - Cloudflare account ID
 * @param databaseId - D1 database ID
 * @param apiToken - Cloudflare API token with D1 query permission
 * @param migrations - Array of {name, sql} migration entries to execute
 */
export async function runTenantMigrations(
  accountId: string,
  databaseId: string,
  apiToken: string,
  migrations: Array<{ name: string; sql: string }> = []
): Promise<void> {
  const queryUrl = `${CF_API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`

  // Create migrations tracking table
  const trackingDDL =
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
  const trackingResponse = await fetch(queryUrl, {
    method: 'POST',
    headers: createHeaders(apiToken),
    body: JSON.stringify({ sql: trackingDDL }),
  })
  const trackingData = (await trackingResponse.json()) as CloudflareApiResponse
  if (!trackingData.success) {
    const errorMsg = trackingData.errors?.[0]?.message || 'Unknown error'
    throw new Error(`Failed to create migrations tracking table: ${errorMsg}`)
  }

  for (const migration of migrations) {
    // Check if migration was already applied
    const checkResponse = await fetch(queryUrl, {
      method: 'POST',
      headers: createHeaders(apiToken),
      body: JSON.stringify({
        sql: 'SELECT name FROM _migrations WHERE name = ?',
        params: [migration.name],
      }),
    })
    const checkData = (await checkResponse.json()) as CloudflareApiResponse<
      Array<{ results: Array<{ name: string }> }>
    >
    if (checkData.success && checkData.result?.[0]?.results?.length) {
      continue // Already applied
    }

    // Execute migration SQL
    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: createHeaders(apiToken),
      body: JSON.stringify({ sql: migration.sql }),
    })
    const data = (await response.json()) as CloudflareApiResponse
    if (!data.success) {
      const errorMsg = data.errors?.[0]?.message || 'Unknown error'
      throw new Error(`Failed to execute migration ${migration.name}: ${errorMsg}`)
    }

    // Record migration as applied
    const recordResponse = await fetch(queryUrl, {
      method: 'POST',
      headers: createHeaders(apiToken),
      body: JSON.stringify({
        sql: 'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
        params: [migration.name, new Date().toISOString()],
      }),
    })
    const recordData = (await recordResponse.json()) as CloudflareApiResponse
    if (!recordData.success) {
      const errorMsg = recordData.errors?.[0]?.message || 'Unknown error'
      throw new Error(`Failed to record migration ${migration.name}: ${errorMsg}`)
    }
  }
}

/**
 * Provision all Cloudflare resources for a tenant.
 *
 * Orchestrates D1, KV, and R2 provisioning, runs database migrations,
 * stores resource IDs in the tenant_resources table, and returns the IDs.
 *
 * If any step fails after resources have been created, attempts cleanup
 * of already-created resources to avoid orphaned resources.
 *
 * @param db - Database connection
 * @param accountId - Cloudflare account ID
 * @param tenantSlug - Tenant slug
 * @param tenantId - Tenant ID for storing resource IDs
 * @param apiToken - Cloudflare API token
 * @param migrations - Optional array of migration entries to apply to the new D1 database
 * @returns Resource IDs
 */
export async function provisionTenant(
  db: Database,
  accountId: string,
  tenantSlug: string,
  tenantId: string,
  apiToken: string,
  migrations: Array<{ name: string; sql: string }> = []
): Promise<TenantResources> {
  let d1DatabaseId: string | undefined
  let kvNamespaceId: string | undefined
  let r2BucketName: string | undefined

  try {
    // Step 1: Provision D1 database
    d1DatabaseId = await provisionD1(accountId, tenantSlug, apiToken)

    // Step 2: Provision KV namespace
    kvNamespaceId = await provisionKV(accountId, tenantSlug, apiToken)

    // Step 3: Provision R2 bucket
    r2BucketName = await provisionR2(accountId, tenantSlug, apiToken)

    // Step 4: Run database migrations
    await runTenantMigrations(accountId, d1DatabaseId, apiToken, migrations)

    // Step 5: Store resource IDs in database
    await tenantsRepository.setResources(db, tenantId, {
      d1DatabaseId,
      kvNamespaceId,
      r2BucketName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    return {
      d1DatabaseId,
      kvNamespaceId,
      r2BucketName,
    }
  } catch (error) {
    // Attempt cleanup of already-created resources
    logger.error('provisioning_failed_attempting_cleanup', { error: error instanceof Error ? error.message : String(error) })

    if (d1DatabaseId) {
      try {
        await deprovisionD1(accountId, d1DatabaseId, apiToken)
      } catch (cleanupError) {
        logger.error('provisioning_cleanup_d1_failed', { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) })
      }
    }

    if (kvNamespaceId) {
      try {
        await deprovisionKV(accountId, kvNamespaceId, apiToken)
      } catch (cleanupError) {
        logger.error('provisioning_cleanup_kv_failed', { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) })
      }
    }

    if (r2BucketName) {
      try {
        await deprovisionR2(accountId, r2BucketName, apiToken)
      } catch (cleanupError) {
        logger.error('provisioning_cleanup_r2_failed', { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) })
      }
    }

    throw error
  }
}

/**
 * Delete a D1 database.
 *
 * @param accountId - Cloudflare account ID
 * @param databaseId - D1 database ID
 * @param apiToken - Cloudflare API token with D1 delete permission
 */
export async function deprovisionD1(
  accountId: string,
  databaseId: string,
  apiToken: string
): Promise<void> {
  const url = `${CF_API_BASE}/accounts/${accountId}/d1/database/${databaseId}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: createHeaders(apiToken),
  })

  const data = (await response.json()) as CloudflareApiResponse

  if (!data.success) {
    const errorMsg = data.errors?.[0]?.message || 'Unknown error'
    throw new Error(`Failed to deprovision D1 database: ${errorMsg}`)
  }
}

/**
 * Delete a KV namespace.
 *
 * @param accountId - Cloudflare account ID
 * @param namespaceId - KV namespace ID
 * @param apiToken - Cloudflare API token with KV delete permission
 */
export async function deprovisionKV(
  accountId: string,
  namespaceId: string,
  apiToken: string
): Promise<void> {
  const url = `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: createHeaders(apiToken),
  })

  const data = (await response.json()) as CloudflareApiResponse

  if (!data.success) {
    const errorMsg = data.errors?.[0]?.message || 'Unknown error'
    throw new Error(`Failed to deprovision KV namespace: ${errorMsg}`)
  }
}

/**
 * Delete an R2 bucket.
 *
 * @param accountId - Cloudflare account ID
 * @param bucketName - R2 bucket name
 * @param apiToken - Cloudflare API token with R2 delete permission
 */
export async function deprovisionR2(
  accountId: string,
  bucketName: string,
  apiToken: string
): Promise<void> {
  const url = `${CF_API_BASE}/accounts/${accountId}/r2/buckets/${bucketName}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: createHeaders(apiToken),
  })

  const data = (await response.json()) as CloudflareApiResponse

  if (!data.success) {
    const errorMsg = data.errors?.[0]?.message || 'Unknown error'
    throw new Error(`Failed to deprovision R2 bucket: ${errorMsg}`)
  }
}

/**
 * Deprovision all Cloudflare resources for a tenant.
 *
 * Orchestrates deletion of D1, KV, and R2 resources, and removes
 * the tenant_resources database record.
 *
 * @param db - Database connection
 * @param accountId - Cloudflare account ID
 * @param tenantSlug - Tenant slug
 * @param tenantId - Tenant ID
 * @param apiToken - Cloudflare API token
 */
export async function deprovisionTenant(
  db: Database,
  accountId: string,
  tenantSlug: string,
  tenantId: string,
  apiToken: string
): Promise<void> {
  // Get current resource IDs
  const resources = await tenantsRepository.getResources(db, tenantId)

  if (!resources) {
    throw new Error(`No resources found for tenant ${tenantSlug}`)
  }

  const errors: Error[] = []

  // Delete D1 database
  if (resources.d1DatabaseId) {
    try {
      await deprovisionD1(accountId, resources.d1DatabaseId, apiToken)
    } catch (error) {
      errors.push(error as Error)
    }
  }

  // Delete KV namespace
  if (resources.kvNamespaceId) {
    try {
      await deprovisionKV(accountId, resources.kvNamespaceId, apiToken)
    } catch (error) {
      errors.push(error as Error)
    }
  }

  // Delete R2 bucket
  if (resources.r2BucketName) {
    try {
      await deprovisionR2(accountId, resources.r2BucketName, apiToken)
    } catch (error) {
      errors.push(error as Error)
    }
  }

  // If any deletions failed, throw a combined error
  if (errors.length > 0) {
    throw new Error(
      `Failed to deprovision some resources: ${errors.map((e) => e.message).join('; ')}`
    )
  }

  // Remove tenant_resources record to allow re-provisioning
  await tenantsRepository.deleteResources(db, tenantId)
}
