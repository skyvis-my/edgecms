import type { vi } from 'bun:test'
import type { CommandContext } from '@/commands/engine'
import type { Env } from '@/main'

type MockLikeFn = ReturnType<typeof vi.fn>
type MockedFn<T> = T extends (...args: infer A) => infer R ? ((...args: A) => R) & MockLikeFn : T
type MockedObj<T extends object> = {
  [K in keyof T]: MockedFn<T[K]>
}

export function asMockedFn<T extends (...args: unknown[]) => unknown>(fn: T) {
  return fn as MockedFn<T>
}

export function asMockedObj<T extends object>(obj: T) {
  return obj as MockedObj<T>
}

export function asCommandEnv(value: Partial<Env>): CommandContext['env'] {
  return value as CommandContext['env']
}
