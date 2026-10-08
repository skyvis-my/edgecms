import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email' : undefined),
  }),
})

export function ForgotPasswordForm({ className, ...props }: React.HTMLAttributes<HTMLFormElement>) {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    type ResetPasswordInput = {
      email: string
      redirectTo?: string
      callbackURL?: string
    }
    type ResetPasswordResult = { error?: { message?: string } | null } | undefined

    const resetPassword = (
      authClient as unknown as {
        forgetPassword?: (input: ResetPasswordInput) => Promise<ResetPasswordResult>
        forgotPassword?: (input: ResetPasswordInput) => Promise<ResetPasswordResult>
      }
    ).forgetPassword ??
      (
        authClient as unknown as {
          forgotPassword?: (input: ResetPasswordInput) => Promise<ResetPasswordResult>
        }
      ).forgotPassword

    if (!resetPassword) {
      setIsLoading(false)
      toast.error('Password reset is not configured. Contact your administrator.')
      return
    }

    const callbackURL =
      typeof window !== 'undefined' ? `${window.location.origin}/otp` : 'http://localhost/otp'
    const result = await resetPassword({
      email: data.email,
      redirectTo: callbackURL,
      callbackURL,
    })

    setIsLoading(false)

    if (result?.error) {
      toast.error(result.error.message ?? 'Password reset request failed.')
      return
    }

    form.reset()
    toast.success('If an account exists for that email, a reset link has been sent.')
    navigate({ to: '/sign-in' })
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-2', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder='name@example.com' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          Continue
          {isLoading ? <Loader2 className='animate-spin' /> : <ArrowRight />}
        </Button>
      </form>
    </Form>
  )
}
