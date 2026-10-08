import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { SignUp } from '@/features/auth/sign-up'
import { getSessionIfNeeded } from '@/lib/auth-client'

const searchSchema = z.object({
  onboarding: z.coerce.boolean().optional(),
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-up')({
  beforeLoad: async () => {
    const { data: session } = await getSessionIfNeeded()
    if (session) {
      throw redirect({ to: '/' })
    }
  },
  component: SignUp,
  validateSearch: searchSchema,
})
