import type { UserRoleOption } from '../data/data'
import { UsersActionDialog } from './users-action-dialog'
import { UsersDeleteDialog } from './users-delete-dialog'
import { UsersInviteDialog } from './users-invite-dialog'
import { useUsers } from './users-provider'

type UsersDialogsProps = {
  roleOptions: readonly UserRoleOption[]
  tenantSlug?: string
}

export function UsersDialogs({ roleOptions, tenantSlug }: UsersDialogsProps) {
  const { open, setOpen, currentRow, setCurrentRow } = useUsers()
  return (
    <>
      <UsersInviteDialog
        key='user-invite'
        open={open === 'invite' || open === 'add'}
        onOpenChange={(next) => setOpen(next ? 'invite' : null)}
        roleOptions={roleOptions}
        tenantSlug={tenantSlug}
      />

      {currentRow && (
        <>
          <UsersActionDialog
            key={`user-edit-${currentRow.id}`}
            open={open === 'edit'}
            onOpenChange={(next) => {
              setOpen(next ? 'edit' : null)
              setTimeout(() => {
                setCurrentRow(null)
              }, 500)
            }}
            currentRow={currentRow}
            roleOptions={roleOptions}
            tenantSlug={tenantSlug}
          />

          <UsersDeleteDialog
            key={`user-delete-${currentRow.id}`}
            open={open === 'delete'}
            onOpenChange={(next) => {
              setOpen(next ? 'delete' : null)
              setTimeout(() => {
                setCurrentRow(null)
              }, 500)
            }}
            currentRow={currentRow}
            tenantSlug={tenantSlug}
          />
        </>
      )}
    </>
  )
}
