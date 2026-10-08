import { createFileRoute } from '@tanstack/react-router'
import z from 'zod'
import { Entries } from '@/features/entries'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

const entriesSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(20),
  filter: z.string().optional().catch(''),
  entry: z.string().optional().catch(''),
  status: z
    .array(
      z.union([
        z.literal('draft'),
        z.literal('scheduled'),
        z.literal('published'),
        z.literal('archived'),
      ])
    )
    .optional()
    .catch([]),
})

export const Route = createFileRoute(
  '/_authenticated/tenants/$tenantSlug/collections/$collectionId/entries/'
)({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  validateSearch: entriesSearchSchema,
  component: Entries,
})
