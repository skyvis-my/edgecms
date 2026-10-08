import { Check, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCollection } from '@/features/collections/api/collections-api'
import { useEntries } from '../api/entries-api'
import type { RelationType } from '../api/relations-api'

type RelationPickerProps = {
  targetCollectionId: string
  relationType: RelationType
  selectedEntryIds: string[]
  onSelect: (entryId: string) => void
}

/**
 * Searchable picker for selecting entries from a target collection
 */
export function RelationPicker({
  targetCollectionId,
  relationType,
  selectedEntryIds,
  onSelect,
}: RelationPickerProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch the target collection to display its name
  const { data: targetCollection } = useCollection(targetCollectionId)

  // Fetch all entries from the target collection
  const { data: entriesResponse, isLoading } = useEntries({
    collectionId: targetCollectionId,
    perPage: 100, // Large enough to show most collections
  })

  const entries = entriesResponse?.data || []

  // Filter entries by search query
  const filteredEntries = entries.filter((entry) => {
    const searchLower = searchQuery.toLowerCase()
    // Search in slug
    if (entry.slug.toLowerCase().includes(searchLower)) return true
    // Search in data fields (text fields only)
    for (const value of Object.values(entry.data)) {
      if (typeof value === 'string' && value.toLowerCase().includes(searchLower)) {
        return true
      }
    }
    return false
  })

  const handleSelect = (entryId: string) => {
    onSelect(entryId)
    // For one-to-one, close immediately after selection
    if (relationType === 'one-to-one') {
      setOpen(false)
    }
  }

  // Get display text for an entry (first text field or slug)
  const getEntryDisplayText = (entryId: string) => {
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return entryId

    // Try to find a text field to display
    const textField = Object.values(entry.data).find((val) => typeof val === 'string')
    if (textField && typeof textField === 'string') {
      return textField.length > 50 ? `${textField.slice(0, 50)}...` : textField
    }

    return entry.slug
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='w-full justify-between'
        >
          {selectedEntryIds.length > 0 && relationType === 'one-to-one'
            ? getEntryDisplayText(selectedEntryIds[0])
            : relationType === 'one-to-one'
              ? 'Select entry...'
              : `Select from ${targetCollection?.name || 'collection'}...`}
          <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[400px] p-0' align='start'>
        <Command>
          <CommandInput
            placeholder='Search entries...'
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>{isLoading ? 'Loading entries...' : 'No entries found.'}</CommandEmpty>
            <CommandGroup>
              <ScrollArea className='h-[300px]'>
                {filteredEntries.map((entry) => {
                  const isSelected = selectedEntryIds.includes(entry.id)
                  const displayText = getEntryDisplayText(entry.id)

                  return (
                    <CommandItem
                      key={entry.id}
                      value={entry.id}
                      onSelect={() => handleSelect(entry.id)}
                      className='flex items-center justify-between'
                    >
                      <div className='flex items-center gap-2 flex-1 min-w-0'>
                        <Check
                          className={`h-4 w-4 shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                        />
                        <div className='flex flex-col flex-1 min-w-0'>
                          <span className='truncate'>{displayText}</span>
                          <span className='text-xs text-muted-foreground truncate'>
                            {entry.slug}
                          </span>
                        </div>
                      </div>
                      <Badge variant='outline' className='ml-2 shrink-0'>
                        {entry.status}
                      </Badge>
                    </CommandItem>
                  )
                })}
              </ScrollArea>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
