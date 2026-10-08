export const DEFAULT_ASSET_ALLOWED_MIME_TYPES: string[] = [
  'image/*',
  'application/pdf',
  'text/plain',
  'text/yaml',
  'text/csv',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/*',
  'video/*',
]

const SAFE_WILDCARD_MIME_TYPES = new Set(['image/*', 'audio/*', 'video/*'])
const DANGEROUS_MIME_TYPES = new Set([
  'application/javascript',
  'application/ecmascript',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-php',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/html',
  'text/javascript',
  'text/ecmascript',
  'text/xml',
])
const DANGEROUS_EXTENSIONS = new Set([
  'apk',
  'app',
  'asp',
  'aspx',
  'bat',
  'bash',
  'bin',
  'cjs',
  'cmd',
  'com',
  'dll',
  'dmg',
  'exe',
  'gadget',
  'hta',
  'htm',
  'html',
  'jar',
  'js',
  'jsp',
  'jsx',
  'mjs',
  'msi',
  'php',
  'pkg',
  'ps1',
  'scr',
  'sh',
  'svg',
  'ts',
  'tsx',
  'vbs',
  'war',
  'wasm',
  'wsf',
])

const MIME_BY_EXTENSION = new Map<string, string>([
  ['avif', 'image/avif'],
  ['csv', 'text/csv'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['gif', 'image/gif'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['json', 'application/json'],
  ['mov', 'video/quicktime'],
  ['mp3', 'audio/mpeg'],
  ['mp4', 'video/mp4'],
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['txt', 'text/plain'],
  ['wav', 'audio/wav'],
  ['webm', 'video/webm'],
  ['webp', 'image/webp'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['yaml', 'text/yaml'],
  ['yml', 'text/yaml'],
])

function getExtension(filename: string) {
  const basename = filename.split('/').pop() ?? filename
  const index = basename.lastIndexOf('.')
  return index >= 0 ? basename.slice(index + 1).toLowerCase() : ''
}

function normalizeMimeType(value: string) {
  return value.trim().toLowerCase()
}

export function resolveFileMimeType(file: File): string {
  const normalized = normalizeMimeType(file.type)
  if (normalized && normalized !== 'application/octet-stream') return normalized
  return MIME_BY_EXTENSION.get(getExtension(file.name)) ?? normalized
}

export function normalizeAllowedAssetMimeTypes(input: string[] | undefined): string[] {
  const source = input && input.length > 0 ? input : [...DEFAULT_ASSET_ALLOWED_MIME_TYPES]
  return [
    ...new Set(
      source
        .map(normalizeMimeType)
        .filter((mimeType) => {
          if (!mimeType) return false
          if (DANGEROUS_MIME_TYPES.has(mimeType)) return false
          if (mimeType.endsWith('/*')) return SAFE_WILDCARD_MIME_TYPES.has(mimeType)
          return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType)
        })
    ),
  ]
}

export function buildAssetAcceptValue(allowedMimeTypes: string[]): string {
  return normalizeAllowedAssetMimeTypes(allowedMimeTypes).join(',')
}

export function isDangerousUploadFile(file: File): boolean {
  const mimeType = resolveFileMimeType(file)
  return DANGEROUS_MIME_TYPES.has(mimeType) || DANGEROUS_EXTENSIONS.has(getExtension(file.name))
}

export function isFileAllowedForUpload(file: File, allowedMimeTypes: string[]): boolean {
  if (isDangerousUploadFile(file)) return false
  const mimeType = resolveFileMimeType(file)
  return normalizeAllowedAssetMimeTypes(allowedMimeTypes).some((allowed) => {
    if (allowed.endsWith('/*')) return mimeType.startsWith(allowed.slice(0, -1))
    return allowed === mimeType
  })
}
