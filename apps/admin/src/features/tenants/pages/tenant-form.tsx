import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { CheckIcon, ChevronsUpDown, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_ASSET_ALLOWED_MIME_TYPES } from '@/features/assets/file-policy'
import { triggerSync } from '@/features/sync/sync-scheduler'
import { CANONICAL_LOCALES } from '@/lib/locales'
import { slugify } from '@/lib/slugify'
import { cn } from '@/lib/utils'
import {
  TENANT_USER_ROLES,
  type TenantDetail,
  type TenantUserRole,
  useAddTenantUser,
  useCreateTenant,
  useDeleteTenant,
  useRemoveTenantUser,
  useUpdateTenant,
  useUpdateTenantUserRole,
} from '../api'

const DEFAULT_MEDIA_UPLOAD_MAX_MB = 5
const DEFAULT_MEDIA_UPLOAD_MAX_DIMENSION = 2048
const BYTES_PER_MB = 1024 * 1024
const DEFAULT_MEDIA_ALLOWED_MIME_TYPES_TEXT = DEFAULT_ASSET_ALLOWED_MIME_TYPES.join('\n')

const tenantFormSchema = z.object({
  name: z.string().min(1, 'Tenant name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  status: z.enum(['active', 'suspended']),
  localeCatalog: z.array(z.string().min(1, 'Locale code cannot be empty')).min(1),
  targetUrl: z.string().url('Target URL must be a valid URL').optional().or(z.literal('')),
  corsOrigin: z.string().url('CORS origin must be a valid URL').optional().or(z.literal('')),
  mediaUploadMaxMb: z
    .number()
    .int('Upload cap must be a whole number')
    .min(1, 'Upload cap must be at least 1 MB'),
  mediaUploadMaxDimension: z
    .number()
    .int('Resize cap must be a whole number')
    .min(1, 'Resize cap must be at least 1 px'),
  mediaAllowedMimeTypesText: z.string().min(1, 'Allowed file types are required'),
})

export type TenantFormValues = z.infer<typeof tenantFormSchema>

const addUserFormSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  role: z.enum(TENANT_USER_ROLES),
})

type AddUserFormValues = z.infer<typeof addUserFormSchema>

type TenantFormProps = {
  tenant?: TenantDetail
  mode: 'create' | 'edit'
}

const localeOptions = CANONICAL_LOCALES

function parseAllowedMimeTypes(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function TenantForm({ tenant, mode }: TenantFormProps) {
  const navigate = useNavigate()
  const createMutation = useCreateTenant()
  const updateMutation = useUpdateTenant()
  const deleteMutation = useDeleteTenant()
  const addUserMutation = useAddTenantUser()
  const removeUserMutation = useRemoveTenantUser()
  const updateRoleMutation = useUpdateTenantUserRole()

  const [showAddUser, setShowAddUser] = useState(false)
  const [userToRemove, setUserToRemove] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [localeMenuOpen, setLocaleMenuOpen] = useState(false)

  const form = useForm<TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: tenant
      ? {
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
          localeCatalog: tenant.localeCatalog?.length ? tenant.localeCatalog : ['en'],
          targetUrl: tenant.targetUrl ?? '',
          corsOrigin: tenant.corsOrigin ?? '',
          mediaUploadMaxMb: Math.max(
            1,
            Math.round((tenant.mediaUploadMaxBytes ?? 5 * 1024 * 1024) / BYTES_PER_MB)
          ),
          mediaUploadMaxDimension:
            tenant.mediaUploadMaxDimension ?? DEFAULT_MEDIA_UPLOAD_MAX_DIMENSION,
          mediaAllowedMimeTypesText: (tenant.mediaAllowedMimeTypes?.length
            ? tenant.mediaAllowedMimeTypes
            : DEFAULT_ASSET_ALLOWED_MIME_TYPES
          ).join('\n'),
        }
      : {
          name: '',
          slug: '',
          status: 'active',
          localeCatalog: ['en'],
          targetUrl: '',
          corsOrigin: '',
          mediaUploadMaxMb: DEFAULT_MEDIA_UPLOAD_MAX_MB,
          mediaUploadMaxDimension: DEFAULT_MEDIA_UPLOAD_MAX_DIMENSION,
          mediaAllowedMimeTypesText: DEFAULT_MEDIA_ALLOWED_MIME_TYPES_TEXT,
        },
  })

  const addUserForm = useForm<AddUserFormValues>({
    resolver: zodResolver(addUserFormSchema),
    defaultValues: {
      userId: '',
      role: 'member',
    },
  })

  const { register, handleSubmit, watch, setValue, formState } = form
  const { errors, isSubmitting } = formState

  // Auto-generate slug from name
  const name = watch('name')
  useEffect(() => {
    if (mode === 'create' && name) {
      setValue('slug', slugify(name))
    }
  }, [name, mode, setValue])

  const onSubmit = async (data: TenantFormValues) => {
    try {
      if (mode === 'create') {
        await createMutation.mutateAsync({
          name: data.name,
          slug: data.slug,
          localeCatalog: data.localeCatalog,
          targetUrl: data.targetUrl || undefined,
          corsOrigin: data.corsOrigin || undefined,
          mediaUploadMaxBytes: data.mediaUploadMaxMb * BYTES_PER_MB,
          mediaUploadMaxDimension: data.mediaUploadMaxDimension,
          mediaAllowedMimeTypes: parseAllowedMimeTypes(data.mediaAllowedMimeTypesText),
        })
        toast.success('Tenant created successfully')
      } else if (tenant) {
        await updateMutation.mutateAsync({
          slug: tenant.slug,
          input: {
            name: data.name,
            slug: data.slug,
            status: data.status,
            localeCatalog: data.localeCatalog,
            targetUrl: data.targetUrl || undefined,
            corsOrigin: data.corsOrigin || undefined,
            mediaUploadMaxBytes: data.mediaUploadMaxMb * BYTES_PER_MB,
            mediaUploadMaxDimension: data.mediaUploadMaxDimension,
            mediaAllowedMimeTypes: parseAllowedMimeTypes(data.mediaAllowedMimeTypesText),
          },
        })
        toast.success('Tenant updated successfully')
      }
      if (navigator.onLine) {
        void triggerSync().catch((syncError) => {
          logger.error('Failed to trigger sync after tenant submit:', syncError)
        })
      }
      navigate({ to: '/admin/tenants' })
    } catch (error) {
      logger.error('Form submission error:', error)
      toast.error('Failed to save tenant')
    }
  }

  const onAddUser = async (data: AddUserFormValues) => {
    if (!tenant) return

    try {
      await addUserMutation.mutateAsync({
        slug: tenant.slug,
        input: data,
      })
      if (navigator.onLine) {
        void triggerSync().catch((syncError) => {
          logger.error('Failed to trigger sync after tenant user add:', syncError)
        })
      }
      toast.success('User added to tenant')
      addUserForm.reset()
      setShowAddUser(false)
    } catch (error) {
      logger.error('Add user error:', error)
      toast.error('Failed to add user')
    }
  }

  const handleRemoveUser = async (userId: string) => {
    if (!tenant) return

    try {
      await removeUserMutation.mutateAsync({
        slug: tenant.slug,
        userId,
      })
      if (navigator.onLine) {
        void triggerSync().catch((syncError) => {
          logger.error('Failed to trigger sync after tenant user removal:', syncError)
        })
      }
      toast.success('User removed from tenant')
      setUserToRemove(null)
    } catch (error) {
      logger.error('Remove user error:', error)
      toast.error('Failed to remove user')
    }
  }

  const handleDeleteTenant = async () => {
    if (!tenant) return

    try {
      await deleteMutation.mutateAsync(tenant.slug)
      toast.success('Tenant deleted successfully')
      navigate({ to: '/admin/tenants' })
    } catch (error) {
      logger.error('Delete tenant error:', error)
      toast.error('Failed to delete tenant')
    } finally {
      setShowDeleteConfirm(false)
    }
  }

  const handleUpdateUserRole = async (userId: string, newRole: TenantUserRole) => {
    if (!tenant) return

    try {
      await updateRoleMutation.mutateAsync({
        slug: tenant.slug,
        userId,
        role: newRole,
      })
      toast.success('User role updated')
    } catch (error) {
      logger.error('Update user role error:', error)
      toast.error('Failed to update user role')
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className='space-y-6'>
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>
              Define the tenant name, slug, status, and available locale options
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='name'>Tenant Name</Label>
                <Input
                  {...register('name')}
                  id='name'
                  placeholder='e.g., Acme Corp, My Project'
                  disabled={isSubmitting}
                />
                {errors.name && <p className='text-sm text-red-600' role='alert' aria-live='polite'>{errors.name.message}</p>}
              </div>

              <div className='space-y-2'>
                <Label htmlFor='slug'>Slug</Label>
                <Input
                  {...register('slug')}
                  id='slug'
                  placeholder='Auto-generated from name'
                  disabled={isSubmitting || mode === 'edit'}
                />
                {errors.slug && <p className='text-sm text-red-600' role='alert' aria-live='polite'>{errors.slug.message}</p>}
                <p className='text-xs text-muted-foreground'>
                  Used in API endpoints: /api/tenants/{watch('slug')}
                </p>
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='status'>Status</Label>
              <Select
                value={watch('status')}
                onValueChange={(value) => setValue('status', value as 'active' | 'suspended')}
                disabled={isSubmitting}
              >
                <SelectTrigger id='status'>
                  <SelectValue placeholder='Select status' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='active'>Active</SelectItem>
                  <SelectItem value='suspended'>Suspended</SelectItem>
                </SelectContent>
              </Select>
              {errors.status && <p className='text-sm text-red-600' role='alert' aria-live='polite'>{errors.status.message}</p>}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='targetUrl'>Target URL</Label>
              <Input
                {...register('targetUrl')}
                id='targetUrl'
                placeholder='https://origin.example.com'
                disabled={isSubmitting}
              />
              {errors.targetUrl && (
                <p className='text-sm text-red-600' role='alert' aria-live='polite'>{errors.targetUrl.message}</p>
              )}
              <p className='text-xs text-muted-foreground'>
                Optional upstream target URL for tenant-specific routing.
              </p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='corsOrigin'>CORS Origin</Label>
              <Input
                {...register('corsOrigin')}
                id='corsOrigin'
                placeholder='https://admin.example.com'
                disabled={isSubmitting}
              />
              {errors.corsOrigin && (
                <p className='text-sm text-red-600' role='alert' aria-live='polite'>{errors.corsOrigin.message}</p>
              )}
              <p className='text-xs text-muted-foreground'>
                Optional allowed origin used for tenant preflight and CORS headers.
              </p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='mediaUploadMaxMb'>Media Upload Cap (MB)</Label>
              <Input
                {...register('mediaUploadMaxMb', { valueAsNumber: true })}
                id='mediaUploadMaxMb'
                type='number'
                min={1}
                step={1}
                disabled={isSubmitting}
              />
              {errors.mediaUploadMaxMb && (
                <p className='text-sm text-red-600' role='alert' aria-live='polite'>
                  {errors.mediaUploadMaxMb.message}
                </p>
              )}
              <p className='text-xs text-muted-foreground'>
                Maximum original file payload accepted for this tenant. Default is 5 MB.
              </p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='mediaUploadMaxDimension'>Image Resize Cap (px)</Label>
              <Input
                {...register('mediaUploadMaxDimension', { valueAsNumber: true })}
                id='mediaUploadMaxDimension'
                type='number'
                min={1}
                step={1}
                disabled={isSubmitting}
              />
              {errors.mediaUploadMaxDimension && (
                <p className='text-sm text-red-600' role='alert' aria-live='polite'>
                  {errors.mediaUploadMaxDimension.message}
                </p>
              )}
              <p className='text-xs text-muted-foreground'>
                Longest image edge after upload optimization. Default is 2048 px.
              </p>
            </div>

            <div className='space-y-2 md:col-span-2'>
              <Label htmlFor='mediaAllowedMimeTypesText'>Allowed File Types</Label>
              <Textarea
                {...register('mediaAllowedMimeTypesText')}
                id='mediaAllowedMimeTypesText'
                rows={8}
                disabled={isSubmitting}
              />
              {errors.mediaAllowedMimeTypesText && (
                <p className='text-sm text-red-600' role='alert' aria-live='polite'>
                  {errors.mediaAllowedMimeTypesText.message}
                </p>
              )}
              <p className='text-xs text-muted-foreground'>
                One MIME type per line. Safe wildcards: image/*, audio/*, video/*.
              </p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='localeCatalog'>Locale Catalog</Label>
              <Popover open={localeMenuOpen} onOpenChange={setLocaleMenuOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id='localeCatalog'
                    type='button'
                    variant='outline'
                    role='combobox'
                    aria-expanded={localeMenuOpen}
                    className='w-full justify-between'
                    disabled={isSubmitting}
                  >
                    {watch('localeCatalog').length > 0
                      ? watch('localeCatalog').join(', ')
                      : 'Select locales...'}
                    <ChevronsUpDown className='ml-2 size-4 shrink-0 opacity-50' />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className='w-[var(--radix-popover-trigger-width)] p-0'
                  align='start'
                >
                  <Command>
                    <CommandInput placeholder='Filter locales...' />
                    <CommandList>
                      <CommandEmpty>No locale found.</CommandEmpty>
                      <CommandGroup>
                        {localeOptions.map((option) => {
                          const selectedLocales = watch('localeCatalog')
                          const isSelected = selectedLocales.includes(option.value)

                          return (
                            <CommandItem
                              key={option.value}
                              value={option.label}
                              onSelect={() => {
                                const nextValues = isSelected
                                  ? selectedLocales.filter((locale) => locale !== option.value)
                                  : [...selectedLocales, option.value]

                                setValue(
                                  'localeCatalog',
                                  nextValues.length > 0 ? nextValues : ['en'],
                                  {
                                    shouldValidate: true,
                                    shouldDirty: true,
                                  }
                                )
                              }}
                            >
                              <CheckIcon
                                className={cn(
                                  'mr-2 size-4',
                                  isSelected ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              {option.label}
                            </CommandItem>
                          )
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className='text-xs text-muted-foreground'>
                Select one or more locales. Use the filter input to quickly find locale codes.
              </p>
              {errors.localeCatalog && (
                <p className='text-sm text-red-600' role='alert' aria-live='polite'>{errors.localeCatalog.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {mode === 'edit' && tenant && (
          <Card>
            <CardHeader>
              <div className='flex items-center justify-between'>
                <div>
                  <CardTitle>User Management</CardTitle>
                  <CardDescription>Manage users who have access to this tenant</CardDescription>
                </div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setShowAddUser(!showAddUser)}
                >
                  <UserPlus className='mr-2 size-4' />
                  Add User
                </Button>
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              {showAddUser && (
                <div className='rounded-md border p-4 space-y-4'>
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <div className='space-y-2'>
                      <Label htmlFor='userId'>User ID or Email</Label>
                      <Input
                        {...addUserForm.register('userId')}
                        id='userId'
                        placeholder='user@example.com'
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor='role'>Role</Label>
                      <Select
                        value={addUserForm.watch('role')}
                        onValueChange={(value) =>
                          addUserForm.setValue('role', value as AddUserFormValues['role'])
                        }
                      >
                        <SelectTrigger id='role'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='owner'>Owner</SelectItem>
                          <SelectItem value='admin'>Admin</SelectItem>
                          <SelectItem value='member'>Member</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className='flex justify-end gap-2'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => setShowAddUser(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      onClick={addUserForm.handleSubmit(onAddUser)}
                      disabled={addUserMutation.isPending}
                    >
                      Add User
                    </Button>
                  </div>
                </div>
              )}

              <div className='rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className='text-right'>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenant.users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className='text-center text-muted-foreground'>
                          No users assigned to this tenant yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      tenant.users.map((tenantUser) => (
                        <TableRow key={tenantUser.id}>
                          <TableCell className='font-medium'>{tenantUser.name}</TableCell>
                          <TableCell>{tenantUser.email}</TableCell>
                          <TableCell>
                            <Select
                              value={tenantUser.role}
                              onValueChange={(value) =>
                                handleUpdateUserRole(tenantUser.id, value as TenantUserRole)
                              }
                            >
                              <SelectTrigger className='h-8 w-28'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TENANT_USER_ROLES.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {r.charAt(0).toUpperCase() + r.slice(1)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className='text-right'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='sm'
                              onClick={() => setUserToRemove(tenantUser.id)}
                            >
                              <Trash2 className='size-4 text-red-600' />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === 'edit' && tenant && (
          <Card className='border-red-200'>
            <CardHeader>
              <CardTitle className='text-red-600'>Danger Zone</CardTitle>
              <CardDescription>
                Permanently delete this tenant and all its associated data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type='button'
                variant='destructive'
                onClick={() => setShowDeleteConfirm(true)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Tenant'}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className='flex justify-end gap-3'>
          <Button
            type='button'
            variant='outline'
            onClick={() => navigate({ to: '/admin/tenants' })}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type='submit' disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Tenant' : 'Update Tenant'}
          </Button>
        </div>
      </form>

      {/* Remove User Confirmation Dialog */}
      <AlertDialog open={!!userToRemove} onOpenChange={() => setUserToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this user from the tenant? They will lose access to
              all tenant resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => userToRemove && handleRemoveUser(userToRemove)}
              className='bg-red-600 hover:bg-red-700'
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Tenant Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tenant</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete &quot;{tenant?.name}&quot;? This action
              cannot be undone. All tenant data, users, and resources will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTenant}
              className='bg-red-600 hover:bg-red-700'
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
