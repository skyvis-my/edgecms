import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { hasTenantContext, resolveTenantBindings } from '@/tenants/tenant-context'
import {
  DEFAULT_ASSET_UPLOAD_MAX_BYTES,
  DEFAULT_ASSET_UPLOAD_MAX_DIMENSION,
  DEFAULT_ASSET_ALLOWED_MIME_TYPES,
  assetsService,
  normalizeAllowedAssetMimeTypes,
  type UploadAssetInput,
} from './assets.service'

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

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
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
    typeof payload.contentBase64 !== 'string'
  ) {
    throw new Error('Upload payload requires filename, mimeType, and contentBase64')
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
    contentBase64: bytesToBase64(bytes),
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

export const assetsController = new Elysia()
  .use(betterAuthPlugin)
  .group('/api/admin/assets', (app) =>
    app
      .post(
        '/upload',
        async (ctx) => {
          const workerEnv = env as unknown as Env
          const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
          const { db, r2 } = resolveTenantBindings(tenantCtx, workerEnv)
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
            return {
              success: false as const,
              error: {
                code: isPayloadTooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
                message: isPayloadTooLarge
                  ? buildUploadTooLargeMessage(maxUploadBytes)
                  : error instanceof Error
                    ? error.message
                    : 'Invalid upload payload',
              },
            }
          }

          try {
            const actorId =
              typeof (ctx as { user?: { id?: unknown } }).user?.id === 'string'
                ? ((ctx as { user?: { id?: string } }).user?.id ?? undefined)
                : undefined
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
            ctx.set.status = 201
            return { success: true as const, data: asset }
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes('Asset upload exceeds maximum size')
            ) {
              ctx.set.status = 413
              return {
                success: false as const,
                error: {
                  code: 'PAYLOAD_TOO_LARGE',
                  message: buildUploadTooLargeMessage(maxUploadBytes),
                },
              }
            }
            if (isUploadTypeBlockedError(error)) {
              ctx.set.status = 415
              return {
                success: false as const,
                error: {
                  code: 'UNSUPPORTED_MEDIA_TYPE',
                  message: error.message,
                },
              }
            }

            const uploadError = classifyUploadServiceError(error)
            logger.error('asset_upload_failed', {
              code: uploadError.code,
              status: uploadError.status,
              reason: uploadError.details.reason,
              tenantId: tenantCtx?.tenant.id ?? 'global',
              filename: uploadInput.filename,
              mimeType: uploadInput.mimeType,
              sizeBase64Length: uploadInput.contentBase64.length,
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
        },
        {
          auth: true,
          body: t.Any(),
        }
      )
      .get(
        '/',
        async (ctx) => {
          const workerEnv = env as unknown as Env
          const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
          const { db } = resolveTenantBindings(tenantCtx, workerEnv)
          const assets = await assetsService.list(db, tenantCtx?.tenant.id)
          return { success: true as const, data: assets }
        },
        { auth: true }
      )
      .get(
        '/config',
        async (ctx) => {
          const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
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
        },
        { auth: true }
      )
      .get(
        '/usage',
        async (ctx) => {
          const workerEnv = env as unknown as Env
          const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
          const { db } = resolveTenantBindings(tenantCtx, workerEnv)
          const usage = await assetsService.usage(db, tenantCtx?.tenant.id)
          return { success: true as const, data: usage }
        },
        { auth: true }
      )
      .get(
        '/:assetId',
        async (ctx) => {
          const workerEnv = env as unknown as Env
          const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
          const { db } = resolveTenantBindings(tenantCtx, workerEnv)
          const asset = await assetsService.getById(db, ctx.params.assetId, tenantCtx?.tenant.id)
          if (!asset) {
            ctx.set.status = 404
            return {
              success: false as const,
              error: { code: 'NOT_FOUND', message: 'Asset not found' },
            }
          }
          return { success: true as const, data: asset }
        },
        { auth: true }
      )
      .put(
        '/:assetId',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const updated = await assetsService.updateFilename(
        db,
        ctx.params.assetId,
        ctx.body.filename,
        tenantCtx?.tenant.id,
        workerEnv,
        getDeferredWorkScheduler(ctx)
      )

      if (!updated) {
        ctx.set.status = 400
        return {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: 'Invalid filename' },
        }
      }

      return { success: true as const, data: updated }
    },
    {
      auth: true,
      body: t.Object({
        filename: t.String(),
      }),
    }
  )
      .delete(
        '/:assetId',
        async (ctx) => {
          const workerEnv = env as unknown as Env
          const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
          const { db, r2 } = resolveTenantBindings(tenantCtx, workerEnv)

          const result = await assetsService.softDelete(
            db,
            r2,
            ctx.params.assetId,
            tenantCtx?.tenant.id,
            workerEnv,
            getDeferredWorkScheduler(ctx)
          )

          if (result.deletedIds.length === 0) {
            ctx.set.status = 404
            return {
              success: false as const,
              error: { code: 'NOT_FOUND', message: 'Asset not found' },
            }
          }

          return { success: true as const, data: result }
        },
        { auth: true }
      )
      .post(
        '/delete',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db, r2 } = resolveTenantBindings(tenantCtx, workerEnv)
      const result = await assetsService.deleteMany(
        db,
        r2,
        ctx.body.ids,
        tenantCtx?.tenant.id,
        workerEnv,
        getDeferredWorkScheduler(ctx)
      )
      return { success: true as const, data: result }
    },
    {
      auth: true,
      body: t.Object({
        ids: t.Array(t.String()),
      }),
    }
  )
      .post(
        '/search',
    async (ctx) => {
      const workerEnv = env as unknown as Env
      const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
      const { db } = resolveTenantBindings(tenantCtx, workerEnv)
      const assets = await assetsService.semanticSearch(
        db,
        ctx.body,
        tenantCtx?.tenant.id,
        workerEnv
      )
      return { success: true as const, data: assets }
    },
    {
      auth: true,
      body: t.Object({
        query: t.String(),
        limit: t.Optional(t.Number()),
        folder: t.Optional(t.String()),
        mimeTypePrefix: t.Optional(t.String()),
      }),
    }
  )
  )
