import { Type, createSchema } from './typebox'
import { collectionConfig, type CollectionConfig } from './collections'

export const managedSchemaOwnership = createSchema(
  Type.Union([Type.Literal('git'), Type.Literal('runtime')])
)
export type ManagedSchemaOwnership = typeof managedSchemaOwnership.infer

export const schemaDiffSeverity = createSchema(
  Type.Union([Type.Literal('safe'), Type.Literal('breaking')])
)
export type SchemaDiffSeverity = typeof schemaDiffSeverity.infer

export const fieldDiffAction = createSchema(
  Type.Union([
    Type.Literal('added'),
    Type.Literal('removed'),
    Type.Literal('modified'),
    Type.Literal('unchanged'),
  ])
)
export type FieldDiffAction = typeof fieldDiffAction.infer

export const fieldDiffItem = createSchema(
  Type.Object({
    fieldName: Type.String(),
    action: fieldDiffAction,
    severity: schemaDiffSeverity,
    description: Type.String(),
  })
)
export type FieldDiffItem = typeof fieldDiffItem.infer

export const schemaDiffResult = createSchema(
  Type.Object({
    status: Type.Union([
      Type.Literal('identical'),
      Type.Literal('compatible'),
      Type.Literal('breaking'),
    ]),
    summary: Type.Object({
      added: Type.Integer({ minimum: 0 }),
      removed: Type.Integer({ minimum: 0 }),
      modified: Type.Integer({ minimum: 0 }),
      unchanged: Type.Integer({ minimum: 0 }),
    }),
    fieldDiffs: Type.Array(fieldDiffItem),
  })
)
export type SchemaDiffResult = typeof schemaDiffResult.infer

export const managedCollectionManifest = createSchema(
  Type.Object({
    schema: collectionConfig,
    schemaHash: Type.String({ minLength: 1 }),
    managedBy: managedSchemaOwnership,
    version: Type.Integer({ minimum: 1 }),
    updatedAt: Type.String(),
  })
)
export type ManagedCollectionManifest = typeof managedCollectionManifest.infer

/**
 * Normalizes and deterministically serializes a CollectionConfig.
 * Fields and options keys are sorted alphabetically.
 */
export function canonicalizeCollectionSchema(config: CollectionConfig): string {
  const sortedFields = [...config.fields]
    .map((field) => ({
      name: field.name,
      type: field.type,
      required: Boolean(field.required),
      localizable: Boolean(field.localizable),
      options: field.options
        ? Object.keys(field.options)
            .sort()
            .reduce<Record<string, unknown>>((acc, key) => {
              acc[key] = field.options![key]
              return acc
            }, {})
        : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const normalized = {
    defaultLocale: config.defaultLocale ?? 'en',
    fields: sortedFields,
    name: config.name.trim(),
    singleton: Boolean(config.singleton),
    slug: config.slug.trim(),
    supportedLocales: config.supportedLocales ? [...config.supportedLocales].sort() : undefined,
  }

  return JSON.stringify(normalized, Object.keys(normalized).sort())
}

// Pure JS SHA-256 so @edgecms/schemas stays browser-bundle safe (no node:crypto import).
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function sha256HexSync(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8
  const paddedLen = ((bytes.length + 9 + 63) >> 6) << 6
  const buf = new Uint8Array(paddedLen)
  buf.set(bytes)
  buf[bytes.length] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false)
  view.setUint32(paddedLen - 4, bitLen >>> 0, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!
      const w2 = w[i - 2]!
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('')
}

/**
 * Computes a deterministic SHA-256 hash of a collection schema.
 */
export function computeSchemaHash(config: CollectionConfig): string {
  const canonical = canonicalizeCollectionSchema(config)
  return sha256HexSync(canonical)
}

/**
 * Compares two collection schemas and classifies field additions, removals, and modifications
 * according to backwards-compatibility rules.
 */
export function diffCollectionSchemas(
  current: CollectionConfig,
  incoming: CollectionConfig
): SchemaDiffResult {
  const currentMap = new Map(current.fields.map((f) => [f.name, f]))
  const incomingMap = new Map(incoming.fields.map((f) => [f.name, f]))

  const fieldDiffs: FieldDiffItem[] = []
  let added = 0
  let removed = 0
  let modified = 0
  let unchanged = 0

  // Check incoming fields
  for (const [name, inField] of incomingMap) {
    const curField = currentMap.get(name)
    if (!curField) {
      added += 1
      const isBreaking = inField.required
      fieldDiffs.push({
        fieldName: name,
        action: 'added',
        severity: isBreaking ? 'breaking' : 'safe',
        description: isBreaking
          ? `Added required field '${name}' without default value`
          : `Added optional field '${name}'`,
      })
    } else {
      // Check modifications
      const typeChanged = curField.type !== inField.type
      const becameRequired = !curField.required && inField.required
      const optionsChanged = JSON.stringify(curField.options) !== JSON.stringify(inField.options)
      const localizableChanged = curField.localizable !== inField.localizable

      if (typeChanged || becameRequired) {
        modified += 1
        const reason = typeChanged
          ? `Field type changed from '${curField.type}' to '${inField.type}'`
          : `Field changed from optional to required`
        fieldDiffs.push({
          fieldName: name,
          action: 'modified',
          severity: 'breaking',
          description: reason,
        })
      } else if (optionsChanged || localizableChanged) {
        modified += 1
        fieldDiffs.push({
          fieldName: name,
          action: 'modified',
          severity: 'safe',
          description: localizableChanged
            ? `Field localization setting updated`
            : `Field options updated`,
        })
      } else {
        unchanged += 1
        fieldDiffs.push({
          fieldName: name,
          action: 'unchanged',
          severity: 'safe',
          description: `Field '${name}' is unchanged`,
        })
      }
    }
  }

  // Check removed fields
  for (const [name] of currentMap) {
    if (!incomingMap.has(name)) {
      removed += 1
      fieldDiffs.push({
        fieldName: name,
        action: 'removed',
        severity: 'breaking',
        description: `Field '${name}' was removed`,
      })
    }
  }

  const hasBreaking = fieldDiffs.some((d) => d.severity === 'breaking')
  const isIdentical = added === 0 && removed === 0 && modified === 0

  const status = isIdentical ? 'identical' : hasBreaking ? 'breaking' : 'compatible'

  return {
    status,
    summary: { added, removed, modified, unchanged },
    fieldDiffs,
  }
}

/**
 * Validates whether an incoming schema mutation is permitted on a managed collection.
 * Rejects mutations if the collection is Git-managed unless allowManagedBypass is explicitly true.
 */
export function validateManagedSchemaMutation(
  manifest: ManagedCollectionManifest,
  incoming: CollectionConfig,
  allowManagedBypass = false
): { allowed: boolean; reason?: string; diff: SchemaDiffResult } {
  const diff = diffCollectionSchemas(manifest.schema, incoming)
  if (diff.status === 'identical') {
    return { allowed: true, diff }
  }

  if (manifest.managedBy === 'git' && !allowManagedBypass) {
    return {
      allowed: false,
      reason:
        'Collection schema is Git-managed. Runtime mutations are locked until transferred to runtime ownership or bypass flag is supplied.',
      diff,
    }
  }

  return { allowed: true, diff }
}
