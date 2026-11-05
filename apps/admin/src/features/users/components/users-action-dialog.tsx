import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { SelectDropdown } from '@/components/select-dropdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ApiClientError } from '@/lib/api-error'
import { useAssignMemberRole, useTenantRoles } from '../api'
import { buildTenantRoleOptions, roles, type UserRoleOption } from '../data/data'
import type { User } from '../data/schema'

const formSchema = z.object({
  email: z.email({
    error: (iss) => (iss.input === '' ? 'Email is required.' : undefined),
  }),
  role: z.string().min(1, 'Role is required.'),
})
type UserForm = z.infer<typeof formSchema>

type UserActionDialogProps = {
  currentRow: User
  open: boolean
  onOpenChange: (open: boolean) => void
  roleOptions?: readonly UserRoleOption[]
  tenantSlug?: string
}

export function UsersActionDialog({
  currentRow,
  open,
  onOpenChange,
  roleOptions = roles,
  tenantSlug,
}: UserActionDialogProps) {
  const assignRole = useAssignMemberRole(tenantSlug)
  const tenantRoles = useTenantRoles(tenantSlug)
  // In a tenant, offer the stored membership roles (built-in and this tenant's
  // custom roles); the server re-checks every rule (PL-03).
  const items = tenantSlug
    ? buildTenantRoleOptions((tenantRoles.data ?? []).map((r) => r.name))
    : roleOptions.map(({ label, value }) => ({ label, value }))
  const form = useForm<UserForm>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: currentRow.email,
      role: (tenantSlug ? currentRow.tenantRole : undefined) ?? currentRow.role,
    },
  })

  const onSubmit = async (values: UserForm) => {
    if (!tenantSlug) {
      toast.error('User mutations are only available in tenant context')
      return
    }

    try {
      await assignRole.mutateAsync({ userId: currentRow.id, role: values.role })
      toast.success('Role updated')
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : 'Failed to update role')
      return
    }

    form.reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(state) => {
        form.reset()
        onOpenChange(state)
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader className='text-start'>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update the user here. Click save when you&apos;re done.
          </DialogDescription>
        </DialogHeader>
        <div className='w-[calc(100%+0.75rem)] overflow-y-auto py-1 pe-3'>
          <Form {...form}>
            <form
              id='user-form'
              onSubmit={form.handleSubmit((values) => void onSubmit(values))}
              className='space-y-4 px-0.5'
            >
              <FormField
                control={form.control}
                name='email'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>Email</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='john.doe@gmail.com'
                        className='col-span-4'
                        disabled
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='role'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>Role</FormLabel>
                    <SelectDropdown
                      defaultValue={field.value}
                      onValueChange={field.onChange}
                      placeholder='Select a role'
                      className='col-span-4'
                      isPending={Boolean(tenantSlug) && tenantRoles.isLoading}
                      items={items}
                    />
                    {tenantSlug && (
                      <FormDescription className='col-span-4 col-start-3 text-xs'>
                        Custom roles come from this tenant&apos;s roles. Only owners can grant
                        Owner, and a tenant keeps at least one owner.
                      </FormDescription>
                    )}
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </div>
        <DialogFooter>
          <Button type='submit' form='user-form' disabled={assignRole.isPending}>
            {assignRole.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
