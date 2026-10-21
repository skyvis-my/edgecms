/** Parses a boolean Worker var: `1`, `true`, `yes` and `on` are true (case-insensitive). */
export function parseBooleanEnv(raw: string | undefined): boolean {
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}
