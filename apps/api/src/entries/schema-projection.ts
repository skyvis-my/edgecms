/**
 * Dynamic Content Modeling: Expand-Contract Virtual Read Projection
 *
 * Projects raw entry record data against the collection schema fields:
 * - If field is missing and `renamedFrom` exists in raw record, projects value from `renamedFrom`.
 * - If field is missing and `defaultValue` is defined, projects `defaultValue`.
 * - Preserves existing values without overwriting.
 */
export function projectEntryDataWithSchema(
  rawRecord: Record<string, unknown> | null | undefined,
  fields: Array<{
    name: string
    renamedFrom?: string
    defaultValue?: unknown
  }>
): Record<string, unknown> {
  const projected = { ...(rawRecord ?? {}) }
  for (const field of fields) {
    if (projected[field.name] === undefined) {
      if (field.renamedFrom && projected[field.renamedFrom] !== undefined) {
        projected[field.name] = projected[field.renamedFrom]
      } else if (field.defaultValue !== undefined) {
        projected[field.name] = field.defaultValue
      }
    }
  }
  return projected
}
