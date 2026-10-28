/**
 * Computes the hierarchical BCP 47 fallback chain for a given locale string.
 *
 * Example:
 *   "zh-Hant-HK" -> ["zh-Hant-HK", "zh-Hant", "zh"]
 *   "en-US"      -> ["en-US", "en"]
 *   "fr"         -> ["fr"]
 */
export function computeFallbackChain(locale: string): string[] {
  if (!locale) return []
  const parts = locale.split('-')
  const chain: string[] = []
  for (let i = parts.length; i > 0; i--) {
    chain.push(parts.slice(0, i).join('-'))
  }
  return chain
}

/**
 * Resolves the optimal matching locale from a set of available locales using
 * the BCP 47 hierarchical fallback chain, falling back to defaultLocale if none match.
 */
export function resolveBestLocale(
  requestedLocale: string,
  availableLocales: string[],
  defaultLocale = 'en'
): string {
  if (!requestedLocale) return defaultLocale
  const availableSet = new Set(availableLocales)
  const chain = computeFallbackChain(requestedLocale)
  for (const candidate of chain) {
    if (availableSet.has(candidate)) {
      return candidate
    }
  }
  return defaultLocale
}
