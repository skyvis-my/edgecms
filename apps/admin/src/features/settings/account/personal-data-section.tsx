import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { edenGet, edenPost } from '@/lib/eden-client'

const CONFIRM_WORD = 'DELETE'

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * HS-13: self-service export and deletion of the signed-in user's personal data.
 * Deletion removes the account and pseudonymizes authored-by references;
 * tenant content stays with the tenant.
 */
export function PersonalDataSection() {
  const [exporting, setExporting] = useState(false)
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const data = await edenGet<unknown>('/me/data-export')
      downloadJson(data, `edgecms-personal-data-${new Date().toISOString().slice(0, 10)}.json`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      // The server deletes every session and clears the session cookies, so no
      // sign-out call is needed (it would reuse the cached session cookie).
      await edenPost('/me/data-deletion', { confirm: CONFIRM_WORD })
      window.location.assign('/sign-in')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deletion failed')
      setDeleting(false)
    }
  }

  return (
    <section aria-labelledby='personal-data-title' className='space-y-4 border-t pt-6'>
      <div>
        <h4 id='personal-data-title' className='text-base font-medium'>
          Your data
        </h4>
        <p className='text-muted-foreground text-sm'>
          Download what EdgeCMS stores about you, or delete your account. Content you wrote
          stays with each tenant; your name on it is replaced by an anonymous ID.
        </p>
      </div>
      <div className='flex flex-wrap gap-3'>
        <Button variant='outline' onClick={handleExport} disabled={exporting}>
          {exporting ? 'Preparing…' : 'Download my data'}
        </Button>
        <Button variant='destructive' onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setConfirmText('')
        }}
        destructive
        title='Delete your account?'
        desc='This signs you out everywhere and removes your account, sessions and memberships. It cannot be undone. If you are the only owner of a tenant, transfer ownership first.'
        confirmText='Delete account'
        isLoading={deleting}
        disabled={confirmText !== CONFIRM_WORD}
        handleConfirm={handleDelete}
      >
        <div className='space-y-2'>
          <Label htmlFor='confirm-delete'>Type {CONFIRM_WORD} to confirm</Label>
          <Input
            id='confirm-delete'
            autoComplete='off'
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
          />
        </div>
      </ConfirmDialog>
    </section>
  )
}
