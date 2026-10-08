import { createContext, type ReactNode, useContext } from 'react'
import useDialogState from '@/hooks/use-dialog-state'

type EntriesContextValue = {
  deleteDialogOpen: string | null
  setDeleteDialogOpen: (id: string | null) => void
}

const EntriesContext = createContext<EntriesContextValue | undefined>(undefined)

export function EntriesProvider({ children }: { children: ReactNode }) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useDialogState<string>(null)

  return (
    <EntriesContext.Provider
      value={{
        deleteDialogOpen,
        setDeleteDialogOpen,
      }}
    >
      {children}
    </EntriesContext.Provider>
  )
}

export function useEntriesContext() {
  const context = useContext(EntriesContext)
  if (!context) {
    throw new Error('useEntriesContext must be used within EntriesProvider')
  }
  return context
}
