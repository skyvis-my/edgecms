export function generateWeakETag(tag: string, payload: unknown): string {
  let marker = ''
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    if (typeof record.generatedAt === 'string') {
      marker = record.generatedAt
    } else if (record.entry && typeof record.entry === 'object') {
      const entry = record.entry as Record<string, unknown>
      marker = `${String(entry.id ?? '')}:${String(entry.updatedAt ?? entry.version ?? '')}`
    } else if (Array.isArray(record.entries)) {
      const itemKeys = record.entries
        .slice(0, 25)
        .map((e) => {
          if (e && typeof e === 'object') {
            const rec = e as Record<string, unknown>
            return `${rec.id ?? ''}:${rec.updatedAt ?? rec.version ?? ''}`
          }
          return String(e ?? '')
        })
        .join(',')
      marker = `${record.total ?? record.entries.length}:${itemKeys}`
    } else {
      try {
        marker = JSON.stringify(record)
      } catch {
        marker = ''
      }
    }
  } else {
    marker = String(payload ?? '')
  }
  const str = `${tag}:${marker}`
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const hex = (h >>> 0).toString(16)
  return `W/"${hex}"`
}
