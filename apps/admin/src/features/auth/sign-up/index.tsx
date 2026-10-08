import { Link, useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { onboarding } = useSearch({ from: '/(auth)/sign-up' })
  const isOnboarding = Boolean(onboarding)

  return (
    <AuthLayout>
      <Card className='gap-4'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>
            {isOnboarding ? 'Create your first admin account' : 'Create an account'}
          </CardTitle>
          <CardDescription>
            {isOnboarding ? (
              <>
                This workspace has no users yet. Create the first account to complete setup.
                <br />
                No sign-in is required for this initial onboarding step.
              </>
            ) : (
              <>
                Enter your email and password to create an account. <br />
                Already have an account?{' '}
                <Link to='/sign-in' className='underline underline-offset-4 hover:text-primary'>
                  Sign In
                </Link>
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm onboarding={isOnboarding} />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            By creating an account, you agree to our{' '}
            <a href='/terms' className='underline underline-offset-4 hover:text-primary'>
              Terms of Service
            </a>{' '}
            and{' '}
            <a href='/privacy' className='underline underline-offset-4 hover:text-primary'>
              Privacy Policy
            </a>
            .
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
