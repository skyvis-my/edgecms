import { and, count, desc, eq, inArray, isNotNull, isNull, like, lt, or, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { assets, assetVariants } from '@/database/schema/assets.schema'

export type AssetRow = typeof assets.$inferSelect
export type AssetVariantRow = typeof assetVariants.$inferSelect
export type AssetWithVariants = AssetRow & { variants: AssetVariantRow[] }
export type AssetUsageSummary = {
  tenantId: string
  assetCount: number
  totalBytes: number
}

function resolveTenantScope(tenantId?: string): string {
  return tenantId ?? 'global'
}

function groupVariantsByAssetId(variants: AssetVariantRow[]): Map<string, AssetVariantRow[]> {
  const map = new Map<string, AssetVariantRow[]>()
  for (const variant of variants) {
    const current = map.get(variant.assetId)
    if (current) {
      current.push(variant)
    } else {
      map.set(variant.assetId, [variant])
    }
  }
  return map
}

export const assetsRepository = {
  async createAsset(db: Database, data: typeof assets.$inferInsert): Promise<AssetRow> {
    const rows = await db
      .insert(assets)
      .values({
        ...data,
        tenantId: data.tenantId ?? 'global',
      })
      .returning()
    const row = rows[0]
    if (!row) {
      throw new Error('Failed to create asset: database returned no rows')
    }
    return row
  },

  async createVariants(db: Database, rows: (typeof assetVariants.$inferInsert)[]): Promise<void> {
    if (rows.length === 0) return
    await db.insert(assetVariants).values(rows)
  },

  async summarizeUsage(db: Database, tenantId?: string): Promise<AssetUsageSummary> {
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .select({
        assetCount: count(assets.id),
        totalBytes: sql<number>`coalesce(sum(${assets.size}), 0)`,
      })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
      .all()
    const row = rows[0]
    return {
      tenantId: tenantScope,
      assetCount: Number(row?.assetCount ?? 0),
      totalBytes: Number(row?.totalBytes ?? 0),
    }
  },

  async summarizeUsageByTenant(db: Database): Promise<AssetUsageSummary[]> {
    const rows = await db
      .select({
        tenantId: assets.tenantId,
        assetCount: count(assets.id),
        totalBytes: sql<number>`coalesce(sum(${assets.size}), 0)`,
      })
      .from(assets)
      .where(isNull(assets.deletedAt))
      .groupBy(assets.tenantId)
      .all()
    return rows.map((row) => ({
      tenantId: row.tenantId,
      assetCount: Number(row.assetCount),
      totalBytes: Number(row.totalBytes ?? 0),
    }))
  },

  async findAll(
    db: Database,
    tenantId?: string,
    options: { limit?: number } = {}
  ): Promise<AssetWithVariants[]> {
    const tenantScope = resolveTenantScope(tenantId)
    const limit = Math.min(100, Math.max(1, options.limit ?? 100))
    const assetRows = await db
      .select()
      .from(assets)
      .where(and(eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
      .orderBy(desc(assets.createdAt))
      .limit(limit)
      .all()
    if (assetRows.length === 0) return []

    const variants = await db
      .select()
      .from(assetVariants)
      .where(
        inArray(
          assetVariants.assetId,
          assetRows.map((asset) => asset.id)
        )
      )
      .all()
    const variantsByAssetId = groupVariantsByAssetId(variants)
    return assetRows.map((asset) => ({
      ...asset,
      variants: variantsByAssetId.get(asset.id) ?? [],
    }))
  },

  async findById(db: Database, id: string, tenantId?: string): Promise<AssetWithVariants | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
      .limit(1)
    const asset = rows[0]
    if (!asset) return undefined
    const variants = await db
      .select()
      .from(assetVariants)
      .where(eq(assetVariants.assetId, id))
      .all()
    return { ...asset, variants }
  },

  async findVariant(
    db: Database,
    assetId: string,
    variant: string,
    format: string,
    tenantId?: string
  ): Promise<AssetVariantRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const fromChain = db
      .select({ variant: assetVariants })
      .from(assetVariants) as unknown as { innerJoin?: unknown }
    // Legacy fallback for mock drivers without innerJoin: single variant
    // select + JS find. (The probe select above already consumed one mock
    // queue slot, so this fallback uses exactly one more select to stay
    // aligned with canned mock results.) Real D1 keeps the join path below.
    if (typeof fromChain.innerJoin !== 'function') {
      const scope = db
        .select()
        .from(assetVariants)
        .where(eq(assetVariants.assetId, assetId)) as unknown as {
        all?: () => Promise<Array<AssetVariantRow | { variant: AssetVariantRow }>>
      }
      const variantRows =
        typeof scope.all === 'function'
          ? await scope.all()
          : ((await scope) as unknown as Array<AssetVariantRow | { variant: AssetVariantRow }>)
      for (const row of variantRows) {
        // Join path wraps rows as { variant: {...} }; plain variant rows
        // also have a `variant` *string* key, so only unwrap objects.
        const wrapped =
          row && typeof row === 'object' && 'variant' in row
            ? (row as { variant: unknown }).variant
            : undefined
        const candidate =
          wrapped && typeof wrapped === 'object'
            ? (wrapped as AssetVariantRow)
            : (row as AssetVariantRow)
        if (candidate?.variant === variant && candidate?.format === format) return candidate
      }
      return undefined
    }
    // Single query: join asset scope check + variant+format predicates (no fetch-all + JS find).
    const rows = await (fromChain as unknown as {
      innerJoin: (
        ...args: unknown[]
      ) => {
        where: (...args: unknown[]) => { limit: (n: number) => { all: () => Promise<Array<{ variant: AssetVariantRow }>> } }
      }
    })
      .innerJoin(assets, eq(assets.id, assetVariants.assetId))
      .where(
        and(
          eq(assetVariants.assetId, assetId),
          eq(assetVariants.variant, variant),
          eq(assetVariants.format, format),
          eq(assets.tenantId, tenantScope),
          isNull(assets.deletedAt)
        )
      )
      .limit(1)
      .all()
    return rows[0]?.variant
  },

  async updateFilename(
    db: Database,
    id: string,
    filename: string,
    tenantId?: string
  ): Promise<AssetWithVariants | undefined> {
    const now = new Date().toISOString()
    const tenantScope = resolveTenantScope(tenantId)
    await db
      .update(assets)
      .set({ filename, updatedAt: now })
      .where(and(eq(assets.id, id), eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
    return this.findById(db, id, tenantScope)
  },

  async softDeleteByIds(db: Database, ids: string[], tenantId?: string): Promise<string[]> {
    if (ids.length === 0) return []
    const tenantScope = resolveTenantScope(tenantId)
    const existing = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(inArray(assets.id, ids), eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
      .all()
    const existingIds = existing.map((row) => row.id)
    if (existingIds.length === 0) return []

    const now = new Date().toISOString()
    await db
      .update(assets)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(assets.id, existingIds), eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
    return existingIds
  },

  async deleteByIds(db: Database, ids: string[], tenantId?: string): Promise<string[]> {
    if (ids.length === 0) return []
    const tenantScope = resolveTenantScope(tenantId)
    // Intentionally matches live AND soft-deleted rows: hard-delete/GC paths
    // must remove rows already marked deletedAt. Tenant scoping still applies.
    const existing = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(inArray(assets.id, ids), eq(assets.tenantId, tenantScope)))
      .all()
    const existingIds = existing.map((row) => row.id)
    if (existingIds.length === 0) return []
    await db.delete(assets).where(and(inArray(assets.id, existingIds), eq(assets.tenantId, tenantScope)))
    return existingIds
  },

  async findByIds(db: Database, ids: string[], tenantId?: string): Promise<AssetWithVariants[]> {
    if (ids.length === 0) return []
    const uniqueIds = [...new Set(ids)]
    const tenantScope = resolveTenantScope(tenantId)
    const assetRows = await db
      .select()
      .from(assets)
      .where(and(inArray(assets.id, uniqueIds), eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
      .all()
    if (assetRows.length === 0) return []

    const variants = await db
      .select()
      .from(assetVariants)
      .where(
        inArray(
          assetVariants.assetId,
          assetRows.map((row) => row.id)
        )
      )
      .all()

    const variantsByAssetId = groupVariantsByAssetId(variants)
    const byId = new Map(assetRows.map((asset) => [asset.id, { ...asset, variants: variantsByAssetId.get(asset.id) ?? [] }]))

    return uniqueIds
      .map((id) => byId.get(id))
      .filter((asset): asset is AssetWithVariants => Boolean(asset))
  },

  async findByIdsIncludingDeleted(
    db: Database,
    ids: string[],
    tenantId?: string
  ): Promise<AssetWithVariants[]> {
    if (ids.length === 0) return []
    const uniqueIds = [...new Set(ids)]
    const tenantScope = resolveTenantScope(tenantId)
    const assetRows = await db
      .select()
      .from(assets)
      .where(and(inArray(assets.id, uniqueIds), eq(assets.tenantId, tenantScope)))
      .all()
    if (assetRows.length === 0) return []

    const variants = await db
      .select()
      .from(assetVariants)
      .where(
        inArray(
          assetVariants.assetId,
          assetRows.map((row) => row.id)
        )
      )
      .all()

    const variantsByAssetId = groupVariantsByAssetId(variants)
    const byId = new Map(assetRows.map((asset) => [asset.id, { ...asset, variants: variantsByAssetId.get(asset.id) ?? [] }]))

    return uniqueIds
      .map((id) => byId.get(id))
      .filter((asset): asset is AssetWithVariants => Boolean(asset))
  },

  async findSoftDeletedBefore(
    db: Database,
    input: { cutoffIso: string; limit?: number; tenantId?: string }
  ): Promise<Array<Pick<AssetRow, 'id' | 'originalKey' | 'tenantId'>>> {
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50) || 50))
    const filters = [
      isNotNull(assets.deletedAt),
      lt(assets.deletedAt, input.cutoffIso),
      input.tenantId ? eq(assets.tenantId, input.tenantId) : undefined,
    ].filter((value) => value !== undefined)
    const rows = await db
      .select({ id: assets.id, originalKey: assets.originalKey, tenantId: assets.tenantId })
      .from(assets)
      .where(and(...filters))
      .orderBy(assets.deletedAt)
      .limit(limit)
      .all()
    return rows
  },

  async searchByTerm(
    db: Database,
    input: { term: string; limit: number; folder?: string; mimeTypePrefix?: string; tenantId?: string }
  ): Promise<AssetWithVariants[]> {
    const limit = Math.min(Math.max(Math.floor(input.limit) || 20, 1), 50)
    const escapedTerm = input.term.replace(/[%_]/g, (char) => `\\${char}`)
    const likeTerm = `%${escapedTerm}%`
    const tenantScope = resolveTenantScope(input.tenantId)
    const filters = [
      eq(assets.tenantId, tenantScope),
      isNull(assets.deletedAt),
      or(like(assets.filename, likeTerm), like(assets.mimeType, likeTerm)),
      input.folder
        ? like(assets.filename, `${input.folder.replace(/[%_]/g, (char) => `\\${char}`)}/%`)
        : undefined,
      input.mimeTypePrefix ? like(assets.mimeType, `${input.mimeTypePrefix}%`) : undefined,
    ].filter((value) => value !== undefined)

    const rows = await db
      .select()
      .from(assets)
      .where(and(...filters))
      .orderBy(
        // Prioritize prefix filename matches before generic contains matches.
        sql`CASE WHEN lower(${assets.filename}) LIKE lower(${`${input.term}%`}) THEN 0 ELSE 1 END`,
        desc(assets.createdAt)
      )
      .limit(limit)
      .all()

    if (rows.length === 0) return []

    const variants = await db
      .select()
      .from(assetVariants)
      .where(
        inArray(
          assetVariants.assetId,
          rows.map((row) => row.id)
        )
      )
      .all()

    const variantsByAssetId = groupVariantsByAssetId(variants)
    return rows.map((asset) => ({
      ...asset,
      variants: variantsByAssetId.get(asset.id) ?? [],
    }))
  },
}
