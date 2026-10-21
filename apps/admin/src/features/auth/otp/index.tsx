import { Link, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { OtpForm } from './components/otp-form'

export function Otp() {
  const { redirect } = useSearch({ from: '/(auth)/otp' })
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp')

  return (
    <AuthLayout>
      <Card className='gap-4'>
        <CardHeader>
          <CardTitle className='text-base tracking-tight'>Two-factor authentication</CardTitle>
          <CardDescription>
            {mode === 'totp'
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Enter one of the recovery codes you saved when you set up two-factor authentication. Each code works once.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OtpForm key={mode} mode={mode} redirectTo={redirect} />
        </CardContent>
        <CardFooter className='flex flex-col gap-2'>
          <Button
            type='button'
            variant='link'
            className='h-auto p-0 text-sm text-muted-foreground'
            onClick={() => setMode(mode === 'totp' ? 'recovery' : 'totp')}
          >
            {mode === 'totp' ? 'Lost your device? Use a recovery code' : 'Use your authenticator app'}
          </Button>
          <Link
            to='/sign-in'
            className='text-sm text-muted-foreground underline underline-offset-4 hover:text-primary'
          >
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
