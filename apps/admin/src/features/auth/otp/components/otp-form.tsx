import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, ShieldCheck } from 'lucide-react'
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
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { refreshSessionAfterLogin, twoFactor } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

const totpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Please enter the 6-digit code.'),
})

const recoverySchema = z.object({
  code: z.string().trim().min(6, 'Please enter a recovery code.'),
})

/** Only same-origin paths; anything else falls back to the dashboard. */
export function safeRedirectPath(redirect: string | undefined): string {
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//')) return '/'
  return redirect
}

type OtpFormProps = React.HTMLAttributes<HTMLFormElement> & {
  mode: 'totp' | 'recovery'
  redirectTo?: string
}

export function OtpForm({ className, mode, redirectTo, ...props }: OtpFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()

  const form = useForm<{ code: string }>({
    resolver: zodResolver(mode === 'totp' ? totpSchema : recoverySchema),
    defaultValues: { code: '' },
  })

  // eslint-disable-next-line react-hooks/incompatible-library
  const code = form.watch('code')

  async function onSubmit({ code }: { code: string }) {
    setIsLoading(true)
    const { error } =
      mode === 'totp'
        ? await twoFactor.verifyTotp({ code })
        : await twoFactor.verifyBackupCode({ code: code.trim() })
    setIsLoading(false)

    if (error) {
      form.reset({ code: '' })
      toast.error(
        error.code === 'INVALID_TWO_FACTOR_COOKIE'
          ? 'This sign-in expired. Please sign in again.'
          : mode === 'totp'
            ? 'That code did not match. Try the current code from your app.'
            : 'That recovery code is invalid or already used.'
      )
      if (error.code === 'INVALID_TWO_FACTOR_COOKIE') navigate({ to: '/sign-in', replace: true })
      return
    }

    await refreshSessionAfterLogin()
    toast.success('Signed in')
    navigate({ to: safeRedirectPath(redirectTo), replace: true })
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
          name='code'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='sr-only'>
                {mode === 'totp' ? 'Authentication code' : 'Recovery code'}
              </FormLabel>
              <FormControl>
                {mode === 'totp' ? (
                  <InputOTP
                    maxLength={6}
                    autoFocus
                    inputMode='numeric'
                    autoComplete='one-time-code'
                    {...field}
                    containerClassName='justify-between sm:[&>[data-slot="input-otp-group"]>div]:w-12'
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                    </InputOTPGroup>
                    <InputOTPSeparator />
                    <InputOTPGroup>
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                ) : (
                  <Input
                    autoFocus
                    autoComplete='off'
                    spellCheck={false}
                    placeholder='xxxxx-xxxxx'
                    className='font-mono tracking-wider'
                    {...field}
                  />
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          className='mt-2'
          disabled={(mode === 'totp' ? code.length < 6 : code.trim().length < 6) || isLoading}
        >
          {isLoading ? <Loader2 className='animate-spin' /> : <ShieldCheck />}
          Verify
        </Button>
      </form>
    </Form>
  )
}
