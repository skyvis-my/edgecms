/**
 * Flatten localizable fields in entry data to a single locale value.
 *
 * For localizable fields stored as `{ en: "Hello", fr: "Bonjour" }`,
 * extracts the value for the requested locale, falling back to the
 * default locale, then null.
 */
export function flattenLocaleFields(
  data: Record<string, unknown>,
  fields: Array<{ name: string; localizable: boolean }>,
  locale: string,
  defaultLocale: string
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    const fieldDef = fields.find((f) => f.name === key)

    if (fieldDef?.localizable && value && typeof value === 'object' && !Array.isArray(value)) {
      const localeObj = value as Record<string, unknown>
      flattened[key] = localeObj[locale] ?? localeObj[defaultLocale] ?? null
    } else {
      flattened[key] = value
    }
  }

  return flattened
}
