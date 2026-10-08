import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { MediaManager } from '@/features/assets/media-manager'
import { normalizeFolderPath } from '@/features/assets/media-utils'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

const mediaSearchSchema = z.object({
  path: z.string().optional(),
})

type MediaSearch = z.infer<typeof mediaSearchSchema>

export function normalizeMediaManagerPath(path?: string) {
  return normalizeFolderPath(path ?? '')
}

export function buildMediaManagerSearch(path: string): MediaSearch {
  const normalizedPath = normalizeMediaManagerPath(path)
  return { path: normalizedPath || undefined }
}

export function buildMediaManagerPathNavigation(path: string) {
  return {
    viewTransition: false as const,
    search: (previous: MediaSearch) => ({ ...previous, ...buildMediaManagerSearch(path) }),
  }
}

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/media/')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  validateSearch: mediaSearchSchema,
  component: MediaPage,
})

function MediaPage() {
  const { tenantSlug } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const currentPath = normalizeMediaManagerPath(search.path)

  return (
    <MediaManager
      currentPath={currentPath}
      tenantSlug={tenantSlug}
      onPathChange={(nextPath) => {
        const normalizedPath = normalizeMediaManagerPath(nextPath)
        if (normalizedPath === currentPath) return
        void navigate(buildMediaManagerPathNavigation(normalizedPath))
      }}
    />
  )
}
