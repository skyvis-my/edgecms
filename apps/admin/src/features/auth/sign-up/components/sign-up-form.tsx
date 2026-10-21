import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { PasswordInput } from '@/components/password-input'
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
import { refreshSessionAfterLogin, signUp } from '@/lib/auth-client'
import { resolveApiBasePath } from '@/lib/eden-client'
import { cn } from '@/lib/utils'

const formSchema = z
  .object({
    firstName: z.string().min(1, 'Please enter your first name'),
    lastName: z.string().min(1, 'Please enter your last name'),
    email: z.email({
      error: (iss) => (iss.input === '' ? 'Please enter your email' : undefined),
    }),
    password: z
      .string()
      .min(1, 'Please enter your password')
      .min(8, 'Password must be at least 8 characters long'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ['confirmPassword'],
  })

function signUpErrorMessage(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case 'SIGNUP_DISABLED':
      return 'Sign-up is closed on this workspace. Ask an administrator for an account.'
    case 'INVITE_REQUIRED':
      return 'Sign-up needs an invite. Use the link from your invite email.'
    case 'INVITE_INVALID':
      return 'This invite is invalid, expired, already used or for another email address.'
    default:
      return error.message ?? 'Sign up failed. Please try again.'
  }
}

type SignUpFormProps = React.HTMLAttributes<HTMLFormElement> & {
  onboarding?: boolean
  /** Single-use invite token from the invite link (`?invite=`). */
  inviteToken?: string
}

export function SignUpForm({
  className,
  onboarding = false,
  inviteToken,
  ...props
}: SignUpFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null)
  const navigate = useNavigate()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    const { data: result, error } = await signUp.email({
      name: `${data.firstName.trim()} ${data.lastName.trim()}`.trim(),
      email: data.email,
      password: data.password,
      fetchOptions: inviteToken ? { headers: { 'x-edgecms-invite-token': inviteToken } } : undefined,
    })

    setIsLoading(false)

    if (error) {
      toast.error(signUpErrorMessage(error))
      return
    }

    // With email verification on, the account exists but has no session yet.
    if (result && result.token === null) {
      setPendingVerificationEmail(data.email)
      return
    }

    if (onboarding) {
      try {
        const response = await fetch(`${resolveApiBasePath()}/bootstrap/provision-tenant`, {
          method: 'POST',
          credentials: 'include',
        })

        let payload: unknown = null
        if (response.status !== 204 && response.status !== 205) {
          const text = await response.text()
          payload = text ? (JSON.parse(text) as unknown) : null
        }

        if (!response.ok) {
          toast.error('Account created, but tenant setup failed. Please sign in and try again.')
          return
        }

        if (
          payload &&
          typeof payload === 'object' &&
          'success' in payload &&
          (payload as { success: boolean }).success &&
          'data' in payload
        ) {
          const tenantData = (payload as { data?: { slug?: string } }).data
          if (tenantData?.slug) {
            localStorage.setItem('edgecms:active-tenant', tenantData.slug)
          }
        }
      } catch {
        toast.error('Account created, but tenant setup failed. Please sign in and try again.')
        return
      }
    }

    await refreshSessionAfterLogin()
    toast.success('Account created successfully!')
    navigate({ to: '/', replace: true })
  }

  if (pendingVerificationEmail) {
    return (
      <div className='grid gap-3 text-sm' role='status'>
        <MailCheck className='size-8 text-primary' aria-hidden />
        <p className='font-medium'>Check your inbox</p>
        <p className='text-muted-foreground'>
          We sent a verification link to <strong>{pendingVerificationEmail}</strong>. Open it to
          finish creating your account, then sign in.
        </p>
        <Button variant='outline' onClick={() => navigate({ to: '/sign-in', replace: true })}>
          Go to sign in
        </Button>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='firstName'
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name</FormLabel>
              <FormControl>
                <Input placeholder='John' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='lastName'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Last Name</FormLabel>
              <FormControl>
                <Input placeholder='Doe' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput placeholder='********' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm Password</FormLabel>
              <FormControl>
                <PasswordInput placeholder='********' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : null}
          Create Account
        </Button>
      </form>
    </Form>
  )
}
