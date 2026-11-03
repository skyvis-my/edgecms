type PutOptions = {
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
}

export type S3R2Options = {
  endpoint?: string
  region?: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
}

/**
 * S3-compatible R2Bucket (MinIO, AWS S3, Alibaba OSS S3 gateway).
 * Uses Bun's built-in S3Client when available.
 */
export function createS3R2(options: S3R2Options): R2Bucket {
  // Bun.S3Client is available on Bun 1.2+
  const S3Client = (Bun as unknown as { S3Client: new (opts: Record<string, unknown>) => {
    file: (key: string) => {
      exists: () => Promise<boolean>
      arrayBuffer: () => Promise<ArrayBuffer>
      write: (data: Uint8Array | string, opts?: { type?: string }) => Promise<number>
      delete: () => Promise<void>
      type?: string
      size?: number
      lastModified?: Date
      etag?: string
    }
    list?: (opts?: { prefix?: string; maxKeys?: number }) => Promise<{
      contents?: Array<{ key: string; size: number; etag?: string; lastModified?: Date }>
    }>
  } }).S3Client

  if (!S3Client) {
    throw new Error('MEDIA_DRIVER=s3 requires Bun S3Client (Bun ≥ 1.2)')
  }

  const client = new S3Client({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    bucket: options.bucket,
    endpoint: options.endpoint,
    region: options.region ?? 'us-east-1',
    virtualHostedStyle: options.forcePathStyle === false,
  })

  const bucket = {
    async head(key: string) {
      const file = client.file(key)
      if (!(await file.exists())) return null
      return {
        key,
        size: file.size ?? 0,
        etag: file.etag ?? '""',
        httpEtag: file.etag ?? '""',
        uploaded: file.lastModified ?? new Date(),
        httpMetadata: file.type ? { contentType: file.type } : undefined,
      }
    },
    async get(key: string) {
      const file = client.file(key)
      if (!(await file.exists())) return null
      const ab = await file.arrayBuffer()
      const body = new Uint8Array(ab)
      return {
        key,
        size: body.byteLength,
        etag: file.etag ?? `"${body.byteLength.toString(16)}"`,
        httpEtag: file.etag ?? `"${body.byteLength.toString(16)}"`,
        uploaded: file.lastModified ?? new Date(),
        httpMetadata: file.type ? { contentType: file.type } : undefined,
        body,
        arrayBuffer: async () => ab,
        text: async () => new TextDecoder().decode(body),
        json: async () => JSON.parse(new TextDecoder().decode(body)),
        blob: async () => new Blob([body]),
        writeHttpMetadata: (headers: Headers) => {
          if (file.type) headers.set('content-type', file.type)
        },
      }
    },
    async put(key: string, value: ArrayBuffer | ArrayBufferView | string | Blob | ReadableStream | null, options?: PutOptions) {
      let bytes: Uint8Array
      if (value === null || value === undefined) bytes = new Uint8Array()
      else if (typeof value === 'string') bytes = new TextEncoder().encode(value)
      else if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer())
      else if (value instanceof ReadableStream) {
        bytes = new Uint8Array(await new Response(value).arrayBuffer())
      } else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
      else bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)

      const file = client.file(key)
      await file.write(bytes, {
        type: options?.httpMetadata?.contentType,
      })
      return {
        key,
        size: bytes.byteLength,
        etag: `"${bytes.byteLength.toString(16)}"`,
        httpEtag: `"${bytes.byteLength.toString(16)}"`,
        uploaded: new Date(),
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      }
    },
    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const key of list) {
        try {
          await client.file(key).delete()
        } catch {
          // missing ok
        }
      }
    },
    async list(listOpts?: { prefix?: string; limit?: number }) {
      if (!client.list) {
        return { objects: [], truncated: false, delimitedPrefixes: [] }
      }
      const result = await client.list({
        prefix: listOpts?.prefix,
        maxKeys: listOpts?.limit ?? 1000,
      })
      const objects = (result.contents ?? []).map((o) => ({
        key: o.key,
        size: o.size,
        etag: o.etag ?? '""',
        uploaded: o.lastModified ?? new Date(),
      }))
      return { objects, truncated: false, delimitedPrefixes: [] }
    },
    createMultipartUpload: async () => {
      throw new Error('Multipart upload is not implemented on S3 R2 adapter')
    },
    resumeMultipartUpload: () => {
      throw new Error('Multipart upload is not implemented on S3 R2 adapter')
    },
  }

  return bucket as unknown as R2Bucket
}
