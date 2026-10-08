export type VariantName = string

export function buildOriginalKey(
  tenantId: string | undefined,
  assetId: string,
  filename: string
): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-')
  return tenantId
    ? `tenants/${tenantId}/assets/${assetId}/original/${safeName}`
    : `assets/${assetId}/original/${safeName}`
}

export function buildVariantKey(
  tenantId: string | undefined,
  assetId: string,
  variant: VariantName,
  format: string
): string {
  return tenantId
    ? `tenants/${tenantId}/assets/${assetId}/variants/${variant}.${format}`
    : `assets/${assetId}/variants/${variant}.${format}`
}
