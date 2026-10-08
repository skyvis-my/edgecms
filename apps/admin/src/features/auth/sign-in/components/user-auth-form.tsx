import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
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
import { refreshSessionAfterLogin, signIn } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Please enter your email' : undefined),
  }),
  password: z
    .string()
    .min(1, 'Please enter your password')
    .min(8, 'Password must be at least 8 characters long'),
})

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
  redirectTo?: string
}

export function UserAuthForm({ className, redirectTo, ...props }: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isEntraLoading, setIsEntraLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const navigate = useNavigate()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)

    const { error } = await signIn.email({
      email: data.email,
      password: data.password,
    })

    setIsLoading(false)

    if (error) {
      toast.error(error.message ?? 'Sign in failed. Please check your credentials.')
      return
    }

    await refreshSessionAfterLogin()
    toast.success('Welcome back!')
    // Redirect to the stored location or default to dashboard
    const targetPath = redirectTo || '/'
    navigate({ to: targetPath, replace: true })
  }

  async function onSignInWithEntra() {
    const socialSignIn = (signIn as unknown as {
      social?: (input: { provider: string; callbackURL?: string }) => Promise<{ error?: { message?: string } }>
    }).social

    if (!socialSignIn) {
      toast.error('Entra ID sign-in is not configured')
      return
    }

    setIsEntraLoading(true)
    const result = await socialSignIn({
      provider: 'microsoft',
      callbackURL: redirectTo || '/',
    })
    setIsEntraLoading(false)

    if (result?.error) {
      toast.error(result.error.message ?? 'Entra ID sign in failed')
    }
  }

  async function onSignInWithGoogle() {
    const socialSignIn = (signIn as unknown as {
      social?: (input: { provider: string; callbackURL?: string }) => Promise<{ error?: { message?: string } }>
    }).social

    if (!socialSignIn) {
      toast.error('Google sign-in is not configured')
      return
    }

    setIsGoogleLoading(true)
    const result = await socialSignIn({
      provider: 'google',
      callbackURL: redirectTo || '/',
    })
    setIsGoogleLoading(false)

    if (result?.error) {
      toast.error(result.error.message ?? 'Google sign in failed')
    }
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
            <FormItem className='relative'>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <PasswordInput placeholder='********' {...field} />
              </FormControl>
              <FormMessage />
              <Link
                to='/forgot-password'
                className='absolute end-0 -top-0.5 text-sm font-medium text-muted-foreground hover:opacity-75'
              >
                Forgot password?
              </Link>
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Sign in
        </Button>
        <Button
          type='button'
          variant='outline'
          disabled={isEntraLoading}
          onClick={onSignInWithEntra}
        >
          {isEntraLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Sign in with Microsoft
        </Button>
        <Button
          type='button'
          variant='outline'
          disabled={isGoogleLoading}
          onClick={onSignInWithGoogle}
        >
          {isGoogleLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          Sign in with Google
        </Button>
      </form>
    </Form>
  )
}
