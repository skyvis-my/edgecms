import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { SignIn } from '@/features/auth/sign-in'
import { getBootstrapStatus } from '@/lib/bootstrap'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-in')({
  beforeLoad: async () => {
    const bootstrapStatus = await getBootstrapStatus()
    if (bootstrapStatus.needsOnboarding) {
      throw redirect({ to: '/sign-up', search: { onboarding: true } })
    }
  },
  component: SignIn,
  validateSearch: searchSchema,
})
