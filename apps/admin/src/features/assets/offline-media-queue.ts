import { db } from '@/features/sync/local-db'
import type { UploadAssetInput } from './api'

type MediaTaskStatus = 'pending' | 'syncing' | 'synced' | 'failed'

type UploadTaskPayload = UploadAssetInput
type MoveTaskPayload = { assetId: string; filename: string }
type DeleteTaskPayload = { ids: string[] }

type MediaTask =
  | {
      id?: number
      type: 'upload'
      payload: UploadTaskPayload
      status: MediaTaskStatus
      createdAt: string
      syncedAt?: string
      error?: string
    }
  | {
      id?: number
      type: 'move'
      payload: MoveTaskPayload
      status: MediaTaskStatus
      createdAt: string
      syncedAt?: string
      error?: string
    }
  | {
      id?: number
      type: 'delete'
      payload: DeleteTaskPayload
      status: MediaTaskStatus
      createdAt: string
      syncedAt?: string
      error?: string
    }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to sync media task'
}

function isPermanentUploadFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  const code = (error as { code?: unknown }).code
  return (
    typeof status === 'number' ||
    (typeof code === 'string' && code.startsWith('ASSET_')) ||
    code === 'IMAGE_PROCESSING_FAILED'
  )
}

function getUploadFingerprint(payload: UploadTaskPayload) {
  return JSON.stringify({
    filename: payload.filename,
    mimeType: payload.mimeType,
    contentBase64: payload.contentBase64,
    width: payload.width ?? null,
    height: payload.height ?? null,
    variants: payload.variants ?? [],
  })
}

export async function enqueueMediaUpload(payload: UploadTaskPayload): Promise<void> {
  await db.mediaQueue.add({
    type: 'upload',
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
  })
}

export async function enqueueMediaMove(payload: MoveTaskPayload): Promise<void> {
  await db.mediaQueue.add({
    type: 'move',
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
  })
}

export async function enqueueMediaDelete(payload: DeleteTaskPayload): Promise<void> {
  await db.mediaQueue.add({
    type: 'delete',
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
  })
}

export async function countPendingMediaTasks(): Promise<number> {
  return db.mediaQueue.where('status').equals('pending').count()
}

export async function processMediaQueue(ops: {
  upload: (payload: UploadTaskPayload) => Promise<void>
  move: (payload: MoveTaskPayload) => Promise<void>
  deleteAssets: (payload: DeleteTaskPayload) => Promise<void>
}): Promise<void> {
  const pending = (await db.mediaQueue.where('status').equals('pending').toArray()) as MediaTask[]
  let firstError: unknown = null
  const processedUploadFingerprints = new Set<string>()

  for (const task of pending) {
    if (task.id === undefined) continue
    await db.mediaQueue.update(task.id, { status: 'syncing', error: undefined })
    try {
      if (task.type === 'upload') {
        const fingerprint = getUploadFingerprint(task.payload)
        if (processedUploadFingerprints.has(fingerprint)) {
          await db.mediaQueue.update(task.id, {
            status: 'synced',
            syncedAt: new Date().toISOString(),
            error: undefined,
          })
          continue
        }
        await ops.upload(task.payload)
        processedUploadFingerprints.add(fingerprint)
      } else if (task.type === 'move') {
        await ops.move(task.payload)
      } else {
        await ops.deleteAssets(task.payload)
      }
      await db.mediaQueue.update(task.id, {
        status: 'synced',
        syncedAt: new Date().toISOString(),
        error: undefined,
      })
    } catch (error) {
      const status =
        task.type === 'upload' && isPermanentUploadFailure(error) ? 'failed' : 'pending'
      await db.mediaQueue.update(task.id, {
        status,
        error: getErrorMessage(error),
      })
      firstError ??= error
    }
  }

  if (firstError) {
    throw firstError
  }
}
