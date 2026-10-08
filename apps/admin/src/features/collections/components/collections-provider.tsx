import { createContext, type ReactNode, useContext } from 'react'
import useDialogState from '@/hooks/use-dialog-state'

type CollectionsContextValue = {
  deleteDialogOpen: string | null
  setDeleteDialogOpen: (id: string | null) => void
}

const CollectionsContext = createContext<CollectionsContextValue | undefined>(undefined)

export function CollectionsProvider({ children }: { children: ReactNode }) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useDialogState<string>(null)

  return (
    <CollectionsContext.Provider
      value={{
        deleteDialogOpen,
        setDeleteDialogOpen,
      }}
    >
      {children}
    </CollectionsContext.Provider>
  )
}

export function useCollectionsContext() {
  const context = useContext(CollectionsContext)
  if (!context) {
    throw new Error('useCollectionsContext must be used within CollectionsProvider')
  }
  return context
}
