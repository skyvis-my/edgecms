import type { FieldDefinition } from '@/features/collections/api/collections-api'

export type ArrayItemSubfield = {
  name: string
  type: FieldDefinition['type']
  required?: boolean
}

export function getLocaleValue(
  value: unknown,
  localizable: boolean,
  activeLocale?: string,
): unknown {
  if (!localizable || !activeLocale) return value
  if (!value || typeof value !== 'object') return ''
  return (value as Record<string, unknown>)[activeLocale] ?? ''
}

export function parseArrayValue(
  raw: string,
  type: string,
): unknown[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (type === 'number') {
    return lines
      .map((line) => Number(line))
      .filter((v) => Number.isFinite(v))
  }

  if (type === 'boolean') {
    return lines
      .map((line) => line.toLowerCase())
      .filter((line) => line === 'true' || line === 'false')
      .map((line) => line === 'true')
  }

  return lines
}

export function arrayValueAsText(currentValue: unknown): string {
  if (!Array.isArray(currentValue)) return ''
  return currentValue.map((item) => String(item ?? '')).join('\n')
}

export function buildArrayItemDefault(
  itemSubfields: ArrayItemSubfield[],
): Record<string, unknown> {
  const initial: Record<string, unknown> = {}
  for (const itemField of itemSubfields) {
    if (itemField.type === 'boolean') {
      initial[itemField.name] = false
      continue
    }
    initial[itemField.name] = null
  }
  return initial
}
