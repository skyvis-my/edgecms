import { Check, Copy, Download, KeyRound, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { encode } from 'uqr'
import { PasswordInput } from '@/components/password-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { refreshSessionAfterLogin, twoFactor, useSession } from '@/lib/auth-client'

type EnrolStep =
  | { name: 'password' }
  | { name: 'scan'; totpURI: string; backupCodes: string[] }
  | { name: 'codes'; backupCodes: string[] }

/** Renders an otpauth URI as an inline SVG QR code (no network, no innerHTML). */
export function TotpQrCode({ value }: { value: string }) {
  const path = useMemo(() => {
    const { data } = encode(value, { ecc: 'M' })
    let d = ''
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      })
    )
    return { d, size: data.length }
  }, [value])

  return (
    <svg
      role='img'
      aria-label='QR code for your authenticator app'
      viewBox={`-2 -2 ${path.size + 4} ${path.size + 4}`}
      className='size-44 rounded-md bg-white p-1'
      shapeRendering='crispEdges'
    >
      <path d={path.d} fill='#000' />
    </svg>
  )
}

/** Extracts the base32 secret for manual entry. */
export function totpSecretFromUri(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get('secret') ?? ''
  } catch {
    return ''
  }
}

function SixDigitInput({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (value: string) => void
  id: string
}) {
  return (
    <InputOTP
      id={id}
      maxLength={6}
      inputMode='numeric'
      autoComplete='one-time-code'
      value={value}
      onChange={onChange}
    >
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  )
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false)
  const text = codes.join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      toast.error('Could not copy. Select the codes and copy them manually.')
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'edgecms-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className='grid gap-3'>
      <ol className='grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border bg-muted/40 p-4 font-mono text-sm'>
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className='flex gap-2'>
        <Button type='button' variant='outline' size='sm' onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button type='button' variant='outline' size='sm' onClick={download}>
          <Download />
          Download
        </Button>
      </div>
    </div>
  )
}

function EnableDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<EnrolStep>({ name: 'password' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  function close(next: boolean) {
    if (!next) {
      setStep({ name: 'password' })
      setPassword('')
      setCode('')
    }
    onOpenChange(next)
  }

  async function start(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    const { data, error } = await twoFactor.enable({ password })
    setBusy(false)
    if (error || !data || !('totpURI' in data) || !data.totpURI) {
      toast.error(error?.message ?? 'Could not start setup. Check your password.')
      return
    }
    setPassword('')
    setStep({ name: 'scan', totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] })
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault()
    if (step.name !== 'scan') return
    setBusy(true)
    const { error } = await twoFactor.verifyTotp({ code })
    setBusy(false)
    if (error) {
      setCode('')
      toast.error('That code did not match. Try the current code from your app.')
      return
    }
    await refreshSessionAfterLogin()
    setStep({ name: 'codes', backupCodes: step.backupCodes })
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className='sm:max-w-md'>
        {step.name === 'password' && (
          <form onSubmit={start} className='grid gap-4'>
            <DialogHeader>
              <DialogTitle>Set up two-factor authentication</DialogTitle>
              <DialogDescription>Confirm your password to continue.</DialogDescription>
            </DialogHeader>
            <div className='grid gap-2'>
              <Label htmlFor='tf-enable-password'>Password</Label>
              <PasswordInput
                id='tf-enable-password'
                autoComplete='current-password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button disabled={!password || busy}>
                {busy ? <Loader2 className='animate-spin' /> : null}
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}

        {step.name === 'scan' && (
          <form onSubmit={confirm} className='grid gap-4'>
            <DialogHeader>
              <DialogTitle>Scan with your authenticator app</DialogTitle>
              <DialogDescription>
                Use an app such as 1Password, Google Authenticator or Authy, then enter the
                6-digit code it shows.
              </DialogDescription>
            </DialogHeader>
            <div className='flex flex-col items-center gap-3'>
              <TotpQrCode value={step.totpURI} />
              <p className='text-center text-xs text-muted-foreground'>
                Can't scan? Enter this key:
                <br />
                <code className='font-mono text-sm break-all text-foreground'>
                  {totpSecretFromUri(step.totpURI)}
                </code>
              </p>
            </div>
            <div className='grid justify-center gap-2'>
              <Label htmlFor='tf-enable-code' className='sr-only'>
                Authentication code
              </Label>
              <SixDigitInput id='tf-enable-code' value={code} onChange={setCode} />
            </div>
            <DialogFooter>
              <Button disabled={code.length < 6 || busy}>
                {busy ? <Loader2 className='animate-spin' /> : <ShieldCheck />}
                Verify and turn on
              </Button>
            </DialogFooter>
          </form>
        )}

        {step.name === 'codes' && (
          <div className='grid gap-4'>
            <DialogHeader>
              <DialogTitle>Save your recovery codes</DialogTitle>
              <DialogDescription>
                Each code signs you in once if you lose your device. They won't be shown again.
              </DialogDescription>
            </DialogHeader>
            <RecoveryCodes codes={step.backupCodes} />
            <DialogFooter>
              <Button onClick={() => close(false)}>I've saved them</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DisableDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    const { error } = await twoFactor.disable({ password })
    setBusy(false)
    if (error) {
      toast.error(error.message ?? 'Could not turn off two-factor authentication.')
      return
    }
    setPassword('')
    await refreshSessionAfterLogin()
    toast.success('Two-factor authentication is off')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={submit} className='grid gap-4'>
          <DialogHeader>
            <DialogTitle>Turn off two-factor authentication?</DialogTitle>
            <DialogDescription>
              Your recovery codes stop working. Workspaces that require MFA will block admin
              access until you turn it back on.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='tf-disable-password'>Password</Label>
            <PasswordInput
              id='tf-disable-password'
              autoComplete='current-password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant='destructive' disabled={!password || busy}>
              {busy ? <Loader2 className='animate-spin' /> : <ShieldOff />}
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TwoFactorSettings() {
  const { data: session, isPending } = useSession()
  const [enableOpen, setEnableOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const enabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled
  )

  return (
    <section aria-labelledby='two-factor-heading' className='grid gap-3 rounded-lg border p-4'>
      <div className='flex items-start justify-between gap-4'>
        <div className='flex gap-3'>
          <KeyRound className='mt-0.5 size-5 shrink-0 text-muted-foreground' aria-hidden />
          <div className='grid gap-1'>
            <h4 id='two-factor-heading' className='font-medium'>
              Two-factor authentication
            </h4>
            <p className='text-sm text-muted-foreground'>
              Ask for a code from your authenticator app when you sign in with your password.
            </p>
          </div>
        </div>
        {!isPending && (
          <Badge variant={enabled ? 'default' : 'outline'} className='shrink-0'>
            {enabled ? 'On' : 'Off'}
          </Badge>
        )}
      </div>
      <div>
        {enabled ? (
          <Button variant='outline' size='sm' onClick={() => setDisableOpen(true)}>
            <ShieldOff />
            Turn off
          </Button>
        ) : (
          <Button size='sm' disabled={isPending} onClick={() => setEnableOpen(true)}>
            <ShieldCheck />
            Set up
          </Button>
        )}
      </div>
      <EnableDialog open={enableOpen} onOpenChange={setEnableOpen} />
      <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
    </section>
  )
}
