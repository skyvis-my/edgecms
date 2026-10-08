import { createFileRoute, redirect } from '@tanstack/react-router'
import { ImportReviewPage } from '@/features/ai/import-review/import-review-page'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/ai/import-review')({
  beforeLoad: () => {
    if (import.meta.env.VITE_ENABLE_AI_IMPORT_REVIEW !== 'true') {
      throw redirect({ to: '/404' })
    }
  },
  component: ImportReviewPage,
})
