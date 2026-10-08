import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import type { NavigateFn } from '@/hooks/use-table-url-state'
import { useUsers } from './api'
import { UsersDialogs } from './components/users-dialogs'
import { UsersPrimaryButtons } from './components/users-primary-buttons'
import { UsersProvider } from './components/users-provider'
import { UsersTable } from './components/users-table'
import { roles, type UserRoleOption } from './data/data'

type UsersPageProps = {
  search: Record<string, unknown>
  navigate: NavigateFn
  roleOptions?: readonly UserRoleOption[]
  tenantSlug?: string
}

export function UsersPage({ search, navigate, roleOptions = roles, tenantSlug }: UsersPageProps) {
  const { data: users = [], isLoading } = useUsers(tenantSlug)

  return (
    <UsersProvider>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>User List</h2>
            <p className='text-muted-foreground'>Manage your users and their roles here.</p>
          </div>
          <UsersPrimaryButtons />
        </div>
        <UsersTable
          data={users}
          search={search}
          navigate={navigate}
          roleOptions={roleOptions}
          isLoading={isLoading}
        />
      </Main>

      <UsersDialogs roleOptions={roleOptions} tenantSlug={tenantSlug} />
    </UsersProvider>
  )
}
