import { Type, type TSchema, type Static } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

const rawSymbol = Symbol.for('TypeBox.Raw')

export function unwrapSchema<T>(s: T): T {
  if (!s || (typeof s !== 'object' && typeof s !== 'function')) return s
  // oxlint-disable-next-line lint/suspicious/noExplicitAny
  const anyS = s as any
  if (anyS[rawSymbol]) return anyS[rawSymbol]
  if (Array.isArray(anyS)) return anyS.map(unwrapSchema) as unknown as T
  if (anyS.properties) {
    // oxlint-disable-next-line lint/suspicious/noExplicitAny
    const props: any = {}
    for (const [k, v] of Object.entries(anyS.properties)) {
      props[k] = unwrapSchema(v)
    }
    return { ...anyS, properties: props }
  }
  if (anyS.items) {
    return { ...anyS, items: unwrapSchema(anyS.items) }
  }
  if (anyS.anyOf) {
    return { ...anyS, anyOf: anyS.anyOf.map(unwrapSchema) }
  }
  return s
}

export type CallableSchema<T extends TSchema> = T & {
  (data: unknown): Static<T> | { issues: Array<{ path: string; message: string; value?: unknown }> }
  infer: Static<T>
  array: () => CallableSchema<ReturnType<typeof Type.Array<T>>>
}

export function createSchema<T extends TSchema>(schema: T): CallableSchema<T> {
  const raw = unwrapSchema(schema)
  const compiled = TypeCompiler.Compile(raw)
  // oxlint-disable-next-line lint/suspicious/noExplicitAny
  const fn: any = (data: unknown) => {
    if (compiled.Check(data)) return data as Static<T>
    const errors = [...compiled.Errors(data)].map((e) => ({
      path: e.path,
      message: e.message,
      value: e.value,
    }))
    return {
      issues: errors,
      toString() {
        return errors.map((e) => `${e.path}: ${e.message}`).join('\n')
      },
    }
  }
  fn[rawSymbol] = raw
  fn.array = () => createSchema(Type.Array(raw))
  return Object.assign(fn, raw) as CallableSchema<T>
}

export { Type }
export type { Static, TSchema }
