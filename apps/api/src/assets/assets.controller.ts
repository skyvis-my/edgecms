import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { logger } from '@/observability/logger'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import {
  DEFAULT_ASSET_UPLOAD_MAX_BYTES,
  DEFAULT_ASSET_UPLOAD_MAX_DIMENSION,
  DEFAULT_ASSET_ALLOWED_MIME_TYPES,
  assetsService,
  normalizeAllowedAssetMimeTypes,
  type UploadAssetInput,
} from './assets.service'
import { estimateUploadBytes, storedAssetBytes } from './storage-bytes'
import { createErrorEnvelope } from '@/shared/utils/service-response'
import { getHostRuntime } from '@/host/host-context'
import { respondLimitExceeded, toLimitTenant } from '@/host/limits'
import type { TenantContext } from '@/tenants/tenant-context'

function buildUploadTooLargeMessage(maxUploadBytes: number) {
  return `Asset upload exceeds maximum size of ${maxUploadBytes} bytes`
}

function isUploadTypeBlockedError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes('Asset upload type is not allowed')
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function classifyUploadServiceError(error: unknown): {
  status: number
  code: string
  message: string
  details: { reason: string }
} {
  const reason = normalizeErrorMessage(error)
  const lowerReason = reason.toLowerCase()

  if (
    lowerReason.includes('unsupported image format') ||
    lowerReason.includes('invalid image') ||
    lowerReason.includes('decode') ||
    lowerReason.includes('corrupt')
  ) {
    return {
      status: 422,
      code: 'IMAGE_PROCESSING_FAILED',
      message: 'Asset upload failed while processing the image',
      details: { reason },
    }
  }

  if (lowerReason.includes('r2') || lowerReason.includes('bucket') || lowerReason.includes('storage')) {
    return {
      status: 503,
      code: 'ASSET_STORAGE_FAILED',
      message: 'Asset upload failed while writing to media storage',
      details: { reason },
    }
  }

  return {
    status: 500,
    code: 'ASSET_UPLOAD_FAILED',
    message: 'Asset upload failed',
    details: { reason },
  }
}

function parseOptionalNumber(value: string | null | undefined): number | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseMultipartVariants(raw: string | undefined): UploadAssetInput['variants'] {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    return parsed
      .filter((variant): variant is NonNullable<UploadAssetInput['variants']>[number] => {
        if (!variant || typeof variant !== 'object') return false
        const typed = variant as Record<string, unknown>
        return typeof typed.variant === 'string' && typeof typed.format === 'string'
      })
      .map((variant) => ({
        variant: variant.variant,
        format: variant.format,
        width: typeof variant.width === 'number' ? variant.width : undefined,
        height: typeof variant.height === 'number' ? variant.height : undefined,
        contentBase64: typeof variant.contentBase64 === 'string' ? variant.contentBase64 : undefined,
      }))
  } catch {
    return undefined
  }
}

function parseUploadBody(body: unknown): UploadAssetInput {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid upload payload')
  }
  const payload = body as Partial<UploadAssetInput>
  if (
    typeof payload.filename !== 'string' ||
    typeof payload.mimeType !== 'string' ||
    (typeof payload.contentBase64 !== 'string' && !(payload.contentBytes instanceof Uint8Array))
  ) {
    throw new Error('Upload payload requires filename, mimeType, and contentBase64 or contentBytes')
  }
  return payload as UploadAssetInput
}

async function normalizeUploadInput(ctx: {
  body: unknown
  request: Request
  maxUploadBytes: number
}): Promise<UploadAssetInput> {
  const contentType = ctx.request.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return parseUploadBody(ctx.body)
  }

  const multipartBody =
    ctx.body && typeof ctx.body === 'object' ? (ctx.body as Record<string, unknown>) : null
  const bodyFile = multipartBody?.file
  const file = bodyFile instanceof Blob ? bodyFile : null
  const payloadFile = file ?? ((await ctx.request.formData()).get('file') as Blob | null)
  if (!(payloadFile instanceof Blob)) {
    throw new Error('Upload payload requires a multipart file field')
  }
  if (payloadFile.size > ctx.maxUploadBytes) {
    throw new Error(buildUploadTooLargeMessage(ctx.maxUploadBytes))
  }
  const fileName = (payloadFile as Blob & { name?: string }).name

  const filenameValue = multipartBody?.filename
  const mimeTypeValue = multipartBody?.mimeType
  const widthValue = multipartBody?.width
  const heightValue = multipartBody?.height
  const blurhashValue = multipartBody?.blurhash
  const variantsValue = multipartBody?.variants

  const filename =
    parseOptionalString(typeof filenameValue === 'string' ? filenameValue : undefined) ??
    parseOptionalString(fileName) ??
    'upload.bin'
  const mimeType =
    parseOptionalString(typeof mimeTypeValue === 'string' ? mimeTypeValue : undefined) ??
    parseOptionalString(payloadFile.type) ??
    'application/octet-stream'

  const bytes = new Uint8Array(await payloadFile.arrayBuffer())
  return {
    filename,
    mimeType,
    contentBytes: bytes,
    width:
      typeof widthValue === 'number'
        ? widthValue
        : parseOptionalNumber(typeof widthValue === 'string' ? widthValue : undefined),
    height:
      typeof heightValue === 'number'
        ? heightValue
        : parseOptionalNumber(typeof heightValue === 'string' ? heightValue : undefined),
    blurhash:
      typeof blurhashValue === 'string' ? blurhashValue : undefined,
    variants:
      typeof variantsValue === 'string'
        ? parseMultipartVariants(variantsValue)
        : parseMultipartVariants(undefined),
  }
}

function getDeferredWorkScheduler(ctx: unknown) {
  const waitUntil = (ctx as { waitUntil?: unknown }).waitUntil
  return typeof waitUntil === 'function'
    ? (promise: Promise<unknown>) => waitUntil.call(ctx, promise)
    : undefined
}

/** HS-05: deleted assets stop counting toward stored media bytes. */
function recordDeletedBytes(
  ctx: { request: Request },
  tenantCtx: TenantContext | undefined,
  deletedBytes: number
): void {
  if (!tenantCtx?.tenant || deletedBytes <= 0) return
  getHostRuntime(ctx.request).usage.record(ctx, {
    tenantId: tenantCtx.tenant.id,
    tenantSlug: tenantCtx.tenant.slug,
    metric: 'media_bytes',
    quantity: -deletedBytes,
  })
}

export const assetsController = new Elysia({ prefix: '/api/admin/assets' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .post('/upload', {
    auth: true,
    body: t.Any(),
  }, async (ctx) => {
    const { db, r2, tenantCtx, workerEnv } = ctx
    const maxUploadBytes =
      tenantCtx?.tenant.mediaUploadMaxBytes ?? DEFAULT_ASSET_UPLOAD_MAX_BYTES
    const maxUploadDimension =
      tenantCtx?.tenant.mediaUploadMaxDimension ?? DEFAULT_ASSET_UPLOAD_MAX_DIMENSION
    const allowedMimeTypes = normalizeAllowedAssetMimeTypes(
      tenantCtx?.tenant.mediaAllowedMimeTypes ?? [...DEFAULT_ASSET_ALLOWED_MIME_TYPES]
    )
  
    let uploadInput: UploadAssetInput
    try {
      uploadInput = await normalizeUploadInput({ ...ctx, maxUploadBytes })
    } catch (error) {
      const isPayloadTooLarge =
        error instanceof Error && error.message.includes('Asset upload exceeds maximum size')
      ctx.set.status = isPayloadTooLarge ? 413 : 400
      return createErrorEnvelope(
        isPayloadTooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
        isPayloadTooLarge
          ? buildUploadTooLargeMessage(maxUploadBytes)
          : error instanceof Error
            ? error.message
            : 'Invalid upload payload'
      )
    }
      
        const actorId =
          typeof (ctx as { user?: { id?: unknown } }).user?.id === 'string'
            ? ((ctx as { user?: { id?: string } }).user?.id ?? undefined)
            : undefined
        const hostRuntime = getHostRuntime(ctx.request)
        if (tenantCtx?.tenant) {
          const exceeded = await hostRuntime.limits.check(ctx, {
            dimension: 'media_bytes',
            amount: estimateUploadBytes(uploadInput),
            tenant: toLimitTenant(tenantCtx.tenant),
            ...(actorId && { actor: { userId: actorId } }),
          })
          if (exceeded) return respondLimitExceeded(ctx.set, exceeded)
        }

        try {
          const asset = await assetsService.upload(
            db,
            r2,
            uploadInput,
            tenantCtx?.tenant.id,
            workerEnv,
            actorId,
            getDeferredWorkScheduler(ctx),
            maxUploadBytes,
            maxUploadDimension,
            allowedMimeTypes
          )
          // Meter what was stored, the same measure deletes subtract.
          if (tenantCtx?.tenant && asset) {
            hostRuntime.usage.record(ctx, {
              tenantId: tenantCtx.tenant.id,
              tenantSlug: tenantCtx.tenant.slug,
              metric: 'media_bytes',
              quantity: storedAssetBytes(asset),
            })
          }
          ctx.set.status = 201
          return { success: true as const, data: asset }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('Asset upload exceeds maximum size')
          ) {
            ctx.set.status = 413
            return createErrorEnvelope(
              'PAYLOAD_TOO_LARGE',
              buildUploadTooLargeMessage(maxUploadBytes)
            )
          }
          if (isUploadTypeBlockedError(error)) {
            ctx.set.status = 415
            return createErrorEnvelope('UNSUPPORTED_MEDIA_TYPE', error.message)
          }
      
          const uploadError = classifyUploadServiceError(error)
          logger.error('asset_upload_failed', {
            code: uploadError.code,
            status: uploadError.status,
            reason: uploadError.details.reason,
            tenantId: tenantCtx?.tenant.id ?? 'global',
            filename: uploadInput.filename,
            mimeType: uploadInput.mimeType,
            sizeBase64Length: uploadInput.contentBase64?.length ?? uploadInput.contentBytes?.byteLength ?? 0,
          })
          ctx.set.status = uploadError.status
          return {
            success: false as const,
            error: {
              code: uploadError.code,
              message: uploadError.message,
              details: uploadError.details,
            },
          }
        }
      })
      .post('/direct-upload-intent', {
        auth: true,
        body: t.Object({
          filename: t.String(),
          mimeType: t.String(),
          size: t.Number(),
        }),
      }, async ({ body, tenantCtx }) => {
        const intent = await assetsService.createDirectUploadIntent(
          body,
          tenantCtx?.tenant.id
        )
        return { success: true as const, data: intent }
      })
      .post('/direct-upload-complete', {
        auth: true,
        body: t.Object({
          assetId: t.String(),
          filename: t.String(),
          mimeType: t.String(),
          size: t.Number(),
          objectKey: t.String(),
        }),
      }, async ({ db, body, set, tenantCtx }) => {
        const asset = await assetsService.confirmDirectUpload(
          db,
          body,
          tenantCtx?.tenant.id
        )
        set.status = 201
        return { success: true as const, data: asset }
      })
      .get('/', { auth: true }, async ({ db, set, tenantCtx }) => {
        if (!tenantCtx?.tenant) {
          set.status = 400
          return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
        }
        const assets = await assetsService.list(db, tenantCtx?.tenant.id)
        return { success: true as const, data: assets }
      })
      .get('/config', { auth: true }, async ({ tenantCtx }) => {
        return {
          success: true as const,
          data: {
            maxUploadBytes:
              tenantCtx?.tenant.mediaUploadMaxBytes ?? DEFAULT_ASSET_UPLOAD_MAX_BYTES,
            maxUploadDimension:
              tenantCtx?.tenant.mediaUploadMaxDimension ?? DEFAULT_ASSET_UPLOAD_MAX_DIMENSION,
            allowedMimeTypes: normalizeAllowedAssetMimeTypes(
              tenantCtx?.tenant.mediaAllowedMimeTypes ?? [...DEFAULT_ASSET_ALLOWED_MIME_TYPES]
            ),
          },
        }
      })
      .get('/usage', { auth: true }, async ({ db, set, tenantCtx }) => {
        if (!tenantCtx?.tenant) {
          set.status = 400
          return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
        }
        const usage = await assetsService.usage(db, tenantCtx?.tenant.id)
        return { success: true as const, data: usage }
      })
      .get('/:assetId', { auth: true }, async ({ db, params, set, tenantCtx }) => {
        if (!tenantCtx?.tenant) {
          set.status = 400
          return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
        }
        const asset = await assetsService.getById(db, params.assetId, tenantCtx?.tenant.id)
        if (!asset) {
          set.status = 404
          return createErrorEnvelope('NOT_FOUND', 'Asset not found')
        }
        return { success: true as const, data: asset }
      })
      .put('/:assetId', {
        auth: true,
        body: t.Object({
          filename: t.String(),
        }),
      }, async (ctx) => {
        const { db, params, body, set, tenantCtx, workerEnv } = ctx
        const updated = await assetsService.updateFilename(
          db,
          params.assetId,
          body.filename,
          tenantCtx?.tenant.id,
          workerEnv,
          getDeferredWorkScheduler(ctx)
        )

        if (!updated) {
          set.status = 400
          return createErrorEnvelope('BAD_REQUEST', 'Invalid filename')
        }

        return { success: true as const, data: updated }
      })
      .delete('/:assetId', { auth: true }, async (ctx) => {
        const { db, r2, params, set, tenantCtx, workerEnv } = ctx
        const result = await assetsService.softDelete(
          db,
          r2,
          params.assetId,
          tenantCtx?.tenant.id,
          workerEnv,
          getDeferredWorkScheduler(ctx)
        )

        if (result.deletedIds.length === 0) {
          set.status = 404
          return createErrorEnvelope('NOT_FOUND', 'Asset not found')
        }
        recordDeletedBytes(ctx, tenantCtx, result.deletedBytes)

        return { success: true as const, data: result }
      })
      .post('/delete', {
        auth: true,
        body: t.Object({
          ids: t.Array(t.String()),
        }),
      }, async (ctx) => {
        const { db, r2, body, set, tenantCtx, workerEnv } = ctx
        if (!tenantCtx?.tenant) {
          set.status = 400
          return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
        }
        const result = await assetsService.deleteMany(
          db,
          r2,
          body.ids,
          tenantCtx?.tenant.id,
          workerEnv,
          getDeferredWorkScheduler(ctx)
        )
        recordDeletedBytes(ctx, tenantCtx, result.deletedBytes)
        return { success: true as const, data: result }
      })
      .post('/search', {
        auth: true,
        body: t.Object({
          query: t.String(),
          limit: t.Optional(t.Number()),
          folder: t.Optional(t.String()),
          mimeTypePrefix: t.Optional(t.String()),
        }),
      }, async ({ db, body, set, tenantCtx, workerEnv }) => {
        if (!tenantCtx?.tenant) {
          set.status = 400
          return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
        }
        const assets = await assetsService.semanticSearch(
          db,
          body,
          tenantCtx?.tenant.id,
          workerEnv
        )
        return { success: true as const, data: assets }
      })
      .post('/gc', {
        auth: true,
        body: t.Object({
          olderThanDays: t.Optional(t.Number()),
          limit: t.Optional(t.Number()),
          tenantId: t.Optional(t.String()),
        }),
      }, async (ctx) => {
        const { db, r2, body, set, tenantCtx, workerEnv } = ctx
        if (!tenantCtx?.tenant) {
          set.status = 400
          return createErrorEnvelope('TENANT_REQUIRED', 'Tenant context is required')
        }
        const result = await assetsService.gcSoftDeleted(
          db,
          r2,
          {
            olderThanDays: body.olderThanDays,
            limit: body.limit,
            tenantId: tenantCtx.tenant.id,
          },
          workerEnv,
          getDeferredWorkScheduler(ctx)
        )
        return { success: true as const, data: result }
      })
      .delete('/:assetId/permanent', { auth: true }, async (ctx) => {
        const { db, r2, params, set, tenantCtx, workerEnv } = ctx
        const result = await assetsService.hardDelete(
          db,
          r2,
          [params.assetId],
          tenantCtx?.tenant.id,
          workerEnv,
          getDeferredWorkScheduler(ctx)
        )

        if (result.deletedIds.length === 0) {
          set.status = 404
          return createErrorEnvelope('NOT_FOUND', 'Asset not found')
        }
        recordDeletedBytes(ctx, tenantCtx, result.deletedBytes)

        return { success: true as const, data: result }
      })
