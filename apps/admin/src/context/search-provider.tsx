import { lazy, Suspense, createContext, useContext, useEffect, useState } from 'react'

const LazyCommandPalette = lazy(() =>
  import('@/features/ai/components/command-palette').then((module) => ({
    default: module.CommandPalette,
  }))
)

type SearchContextType = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
}

const SearchContext = createContext<SearchContextType | null>(null)

type SearchProviderProps = {
  children: React.ReactNode
}

export function SearchProvider({ children }: SearchProviderProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return (
    <SearchContext value={{ open, setOpen }}>
      {children}
      <Suspense fallback={null}>
        <LazyCommandPalette
          open={open}
          onOpenChange={(nextOpen) => setOpen(nextOpen)}
          enableKeyboardShortcut={false}
        />
      </Suspense>
    </SearchContext>
  )
}

export const useOptionalSearch = () => useContext(SearchContext)

// eslint-disable-next-line react-refresh/only-export-components
export const useSearch = () => {
  const searchContext = useOptionalSearch()

  if (!searchContext) {
    throw new Error('useSearch has to be used within SearchProvider')
  }

  return searchContext
}
