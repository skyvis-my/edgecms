import { type } from 'arktype'

/**
 * Locale-related schemas for EdgeCMS i18n support.
 *
 * These schemas handle BCP 47 locale codes and localized content values.
 * Localizable fields store their values as objects keyed by locale code,
 * e.g. { en: "Hello", fr: "Bonjour" }
 */

/**
 * BCP 47 locale code pattern.
 *
 * Supports formats like:
 * - Language only: "en", "fr", "de"
 * - Language + region: "en-US", "zh-CN", "pt-BR"
 * - Language + script + region: "zh-Hans-CN"
 *
 * Pattern: lowercase letters, followed by optional hyphen-separated segments.
 */
export const locale = type(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/)

export type Locale = typeof locale.infer

/**
 * A localized value object — maps locale codes to their translated values.
 *
 * Example: { en: "Hello World", fr: "Bonjour le Monde", de: "Hallo Welt" }
 *
 * Used for fields with localizable: true in the collection definition.
 * The keys should be BCP 47 locale codes from the collection's supportedLocales.
 */
export const localizedValue = type('Record<string, unknown>')

export type LocalizedValue = typeof localizedValue.infer

/**
 * Optional locale query parameter for API requests.
 *
 * When provided, the API will flatten localized fields to show only
 * the requested locale's values, falling back to the collection's defaultLocale.
 */
export const localeQueryParam = type('string | undefined')

export type LocaleQueryParam = typeof localeQueryParam.infer
