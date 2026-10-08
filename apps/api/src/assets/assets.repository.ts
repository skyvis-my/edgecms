import { and, count, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
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
    return rows[0] as AssetRow
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

  async findAll(db: Database, tenantId?: string): Promise<AssetWithVariants[]> {
    const tenantScope = resolveTenantScope(tenantId)
    const assetRows = await db
      .select()
      .from(assets)
      .where(and(eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
      .orderBy(desc(assets.createdAt))
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
    const asset = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
      .limit(1)
      .all()
    if (asset.length === 0) {
      return undefined
    }
    const rows = await db
      .select()
      .from(assetVariants)
      .where(eq(assetVariants.assetId, assetId))
      .all()

    return rows.find((row) => row.variant === variant && row.format === format)
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
    const existing = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(inArray(assets.id, ids), eq(assets.tenantId, tenantScope), isNull(assets.deletedAt)))
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

  async searchByTerm(
    db: Database,
    input: { term: string; limit: number; folder?: string; mimeTypePrefix?: string; tenantId?: string }
  ): Promise<AssetWithVariants[]> {
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
      .limit(input.limit)
      .all()

    if (rows.length === 0) return []
    return this.findByIds(
      db,
      rows.map((row) => row.id),
      tenantScope
    )
  },
}
