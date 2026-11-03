import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type PutOptions = {
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
}

type StoredObject = {
  body: Uint8Array
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
  uploaded: Date
  size: number
  etag: string
}

function keyToPath(root: string, key: string): string {
  const safe = key.replace(/\.\./g, '_').replace(/^\/+/, '')
  return join(root, safe)
}

function metaPath(objectPath: string): string {
  return `${objectPath}.meta.json`
}

/**
 * Filesystem R2Bucket for local/Docker media (MD-* without Cloudflare R2).
 */
export function createFilesystemR2(rootDir: string): R2Bucket {
  mkdirSync(rootDir, { recursive: true })

  async function readObject(key: string): Promise<StoredObject | null> {
    const path = keyToPath(rootDir, key)
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    const body = new Uint8Array(await file.arrayBuffer())
    let httpMetadata: StoredObject['httpMetadata']
    let customMetadata: StoredObject['customMetadata']
    let uploaded = new Date(file.lastModified)
    const metaFile = Bun.file(metaPath(path))
    if (await metaFile.exists()) {
      try {
        const meta = (await metaFile.json()) as {
          httpMetadata?: StoredObject['httpMetadata']
          customMetadata?: StoredObject['customMetadata']
          uploaded?: string
        }
        httpMetadata = meta.httpMetadata
        customMetadata = meta.customMetadata
        if (meta.uploaded) uploaded = new Date(meta.uploaded)
      } catch {
        // ignore corrupt meta
      }
    }
    return {
      body,
      httpMetadata,
      customMetadata,
      uploaded,
      size: body.byteLength,
      etag: `"${body.byteLength.toString(16)}"`,
    }
  }

  const bucket = {
    async head(key: string) {
      const obj = await readObject(key)
      if (!obj) return null
      return {
        key,
        size: obj.size,
        etag: obj.etag,
        httpEtag: obj.etag,
        uploaded: obj.uploaded,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
      }
    },
    async get(key: string) {
      const obj = await readObject(key)
      if (!obj) return null
      return {
        key,
        size: obj.size,
        etag: obj.etag,
        httpEtag: obj.etag,
        uploaded: obj.uploaded,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
        body: obj.body,
        arrayBuffer: async () => obj.body.buffer.slice(obj.body.byteOffset, obj.body.byteOffset + obj.body.byteLength),
        text: async () => new TextDecoder().decode(obj.body),
        json: async () => JSON.parse(new TextDecoder().decode(obj.body)),
        blob: async () => new Blob([obj.body]),
        writeHttpMetadata: (headers: Headers) => {
          if (obj.httpMetadata?.contentType) {
            headers.set('content-type', obj.httpMetadata.contentType)
          }
        },
      }
    },
    async put(key: string, value: ArrayBuffer | ArrayBufferView | string | Blob | ReadableStream | null, options?: PutOptions) {
      const path = keyToPath(rootDir, key)
      mkdirSync(join(path, '..'), { recursive: true })
      let bytes: Uint8Array
      if (value === null || value === undefined) bytes = new Uint8Array()
      else if (typeof value === 'string') bytes = new TextEncoder().encode(value)
      else if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer())
      else if (value instanceof ReadableStream) {
        const res = new Response(value)
        bytes = new Uint8Array(await res.arrayBuffer())
      } else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
      else bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)

      await Bun.write(path, bytes)
      const uploaded = new Date()
      await Bun.write(
        metaPath(path),
        JSON.stringify({
          httpMetadata: options?.httpMetadata,
          customMetadata: options?.customMetadata,
          uploaded: uploaded.toISOString(),
        })
      )
      return {
        key,
        size: bytes.byteLength,
        etag: `"${bytes.byteLength.toString(16)}"`,
        httpEtag: `"${bytes.byteLength.toString(16)}"`,
        uploaded,
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      }
    },
    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const key of list) {
        const path = keyToPath(rootDir, key)
        try {
          await Bun.file(path).unlink?.()
        } catch {
          // Bun.file may not have unlink — use rm via shell-less fs
        }
        try {
          const { unlinkSync } = await import('node:fs')
          unlinkSync(path)
          try {
            unlinkSync(metaPath(path))
          } catch {
            // no meta
          }
        } catch {
          // missing is fine
        }
      }
    },
    async list(options?: { prefix?: string; limit?: number }) {
      // Minimal listing via recursive readdir when needed
      const { readdirSync, statSync } = await import('node:fs')
      const prefix = options?.prefix ?? ''
      const limit = options?.limit ?? 1000
      const objects: Array<{ key: string; size: number; etag: string; uploaded: Date }> = []

      const walk = (dir: string, rel: string) => {
        let entries: string[]
        try {
          entries = readdirSync(dir)
        } catch {
          return
        }
        for (const name of entries) {
          if (name.endsWith('.meta.json')) continue
          const full = join(dir, name)
          const key = rel ? `${rel}/${name}` : name
          const st = statSync(full)
          if (st.isDirectory()) walk(full, key)
          else if (key.startsWith(prefix)) {
            objects.push({
              key,
              size: st.size,
              etag: `"${st.size.toString(16)}"`,
              uploaded: st.mtime,
            })
            if (objects.length >= limit) return
          }
        }
      }
      walk(rootDir, '')
      return { objects: objects.slice(0, limit), truncated: objects.length > limit, delimitedPrefixes: [] }
    },
    createMultipartUpload: async () => {
      throw new Error('Multipart upload is not implemented on filesystem R2 adapter')
    },
    resumeMultipartUpload: () => {
      throw new Error('Multipart upload is not implemented on filesystem R2 adapter')
    },
  }

  return bucket as unknown as R2Bucket
}
