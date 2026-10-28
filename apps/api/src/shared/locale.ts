/**
 * Computes a hierarchical BCP 47 fallback chain.
 * E.g., for target 'fr-CA' with default 'en':
 * 1. Target locale: 'fr-CA'
 * 2. Explicit custom fallbacks if configured: e.g. customFallbacks['fr-CA'] -> ['fr-FR']
 * 3. Base language tag: 'fr' (if not already included)
 * 4. Default locale: 'en'
 *
 * Example:
 * computeFallbackChain('fr-CA', 'en', { 'fr-CA': ['fr-FR'] }) => ['fr-CA', 'fr-FR', 'fr', 'en']
 */
export function computeFallbackChain(
  targetLocale: string,
  defaultLocale: string,
  customFallbacks?: Record<string, string[]>
): string[] {
  const chain: string[] = []
  const seen = new Set<string>()

  const add = (loc: string | undefined) => {
    if (loc && !seen.has(loc)) {
      seen.add(loc)
      chain.push(loc)
    }
  }

  // 1. Requested target
  add(targetLocale)

  // 2. Custom fallback array if provided
  if (customFallbacks?.[targetLocale]) {
    for (const fb of customFallbacks[targetLocale]) {
      add(fb)
    }
  }

  // 3. Base language tag (e.g., 'fr-CA' -> 'fr')
  const baseTag = targetLocale.includes('-') ? targetLocale.split('-')[0] : undefined
  add(baseTag)

  // 4. Default locale
  add(defaultLocale)

  return chain
}

/**
 * Flatten localizable fields in entry data to a single locale value.
 *
 * For localizable fields stored as `{ en: "Hello", fr: "Bonjour" }`,
 * extracts the value using the hierarchical fallback chain, falling back to null
 * if no translation in the chain exists.
 */
export function flattenLocaleFields(
  data: Record<string, unknown>,
  fields: Array<{ name: string; localizable: boolean }>,
  locale: string,
  defaultLocale: string,
  customFallbacks?: Record<string, string[]>
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {}
  const fallbackChain = computeFallbackChain(locale, defaultLocale, customFallbacks)

  for (const [key, value] of Object.entries(data)) {
    const fieldDef = fields.find((f) => f.name === key)

    if (fieldDef?.localizable && value && typeof value === 'object' && !Array.isArray(value)) {
      const localeObj = value as Record<string, unknown>
      let resolvedValue: unknown = null
      for (const candidate of fallbackChain) {
        if (localeObj[candidate] !== undefined && localeObj[candidate] !== null) {
          resolvedValue = localeObj[candidate]
          break
        }
      }
      flattened[key] = resolvedValue
    } else {
      flattened[key] = value
    }
  }

  return flattened
}
