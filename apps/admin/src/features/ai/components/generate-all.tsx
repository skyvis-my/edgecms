import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { FieldDefinition } from '@/features/collections/api/collections-api'
import { useAiCommand } from '../api'

type FieldSuggestion = {
  fieldName: string
  currentValue: unknown
  suggestedValue: unknown
  accepted: boolean
}

type GenerateAllProps = {
  collectionSlug: string
  fields: FieldDefinition[]
  currentValues: Record<string, unknown>
  onApplySuggestions: (suggestions: Record<string, unknown>) => void
  entryId?: string
}

/**
 * Generate All button that triggers AI suggestions for all empty fields
 */
export function GenerateAll({
  collectionSlug,
  fields,
  currentValues,
  onApplySuggestions,
  entryId,
}: GenerateAllProps) {
  const [suggestions, setSuggestions] = useState<FieldSuggestion[]>([])
  const [showDialog, setShowDialog] = useState(false)
  const aiCommandMutation = useAiCommand()

  // Find empty fields
  const emptyFields = fields.filter((field) => {
    const value = currentValues[field.name]
    if (value === null || value === undefined || value === '') return true
    if (Array.isArray(value) && value.length === 0) return true
    if (typeof value === 'object' && Object.keys(value).length === 0) return true
    return false
  })

  const handleGenerateAll = async () => {
    if (emptyFields.length === 0) {
      return
    }

    const emptyFieldNames = emptyFields.map((f) => f.name).join(', ')
    const prompt = `Suggest values for all empty fields (${emptyFieldNames}) in the '${collectionSlug}' collection. Current values: ${JSON.stringify(currentValues, null, 2)}`

    try {
      const response = await aiCommandMutation.mutateAsync({
        prompt,
        context: {
          collectionSlug,
          entryId,
        },
        dryRun: true,
      })

      // Extract suggested values from AI response
      const updateCommand = response.commands.find(
        (cmd) => cmd.type === 'updateEntry' || cmd.type === 'createEntry'
      )

      if (updateCommand?.payload?.data) {
        const suggestedData = updateCommand.payload.data as Record<string, unknown>
        const newSuggestions: FieldSuggestion[] = []

        for (const field of emptyFields) {
          const suggestedValue = suggestedData[field.name]
          if (suggestedValue !== undefined) {
            newSuggestions.push({
              fieldName: field.name,
              currentValue: currentValues[field.name],
              suggestedValue,
              accepted: true, // Default to accepted
            })
          }
        }

        setSuggestions(newSuggestions)
        setShowDialog(true)
      }
    } catch (error) {
      logger.error('AI generate all error:', error)
    }
  }

  const handleToggleSuggestion = (index: number) => {
    setSuggestions((prev) =>
      prev.map((s, i) => (i === index ? { ...s, accepted: !s.accepted } : s))
    )
  }

  const handleAcceptAll = () => {
    const acceptedSuggestions = suggestions
      .filter((s) => s.accepted)
      .reduce(
        (acc, s) => {
          acc[s.fieldName] = s.suggestedValue
          return acc
        },
        {} as Record<string, unknown>
      )

    onApplySuggestions(acceptedSuggestions)
    setShowDialog(false)
    setSuggestions([])
  }

  const handleRejectAll = () => {
    setShowDialog(false)
    setSuggestions([])
  }

  const isLoading = aiCommandMutation.isPending
  const hasEmptyFields = emptyFields.length > 0

  return (
    <>
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='gap-2'
        onClick={handleGenerateAll}
        disabled={isLoading || !hasEmptyFields}
        title={hasEmptyFields ? 'Generate AI suggestions for all empty fields' : 'No empty fields'}
      >
        {isLoading ? (
          <>
            <Loader2 className='h-4 w-4 animate-spin' />
            Generating...
          </>
        ) : (
          <>
            <Sparkles className='h-4 w-4 text-purple-500' />
            AI Generate All
          </>
        )}
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>AI Field Suggestions</DialogTitle>
            <DialogDescription>
              Review and accept the AI-generated suggestions for empty fields. Click on a suggestion
              to toggle selection.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className='max-h-[400px] pr-4'>
            <div className='space-y-3'>
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.fieldName}
                  type='button'
                  className={`w-full text-left p-3 rounded-md border transition-colors ${
                    suggestion.accepted
                      ? 'border-purple-300 bg-purple-50 dark:bg-purple-950/20'
                      : 'border-gray-200 bg-gray-50 dark:bg-gray-900'
                  }`}
                  onClick={() => handleToggleSuggestion(index)}
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='flex-1 min-w-0'>
                      <p className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                        {suggestion.fieldName}
                      </p>
                      <p className='text-sm text-gray-600 dark:text-gray-400 break-words'>
                        {typeof suggestion.suggestedValue === 'string' &&
                        suggestion.suggestedValue.length > 150
                          ? `${suggestion.suggestedValue.slice(0, 150)}...`
                          : String(suggestion.suggestedValue)}
                      </p>
                    </div>
                    <div className='flex-shrink-0'>
                      {suggestion.accepted ? (
                        <Check className='h-5 w-5 text-green-600 dark:text-green-400' />
                      ) : (
                        <X className='h-5 w-5 text-gray-400' />
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter className='gap-2'>
            <Button type='button' variant='outline' onClick={handleRejectAll}>
              Cancel
            </Button>
            <Button
              type='button'
              onClick={handleAcceptAll}
              disabled={suggestions.filter((s) => s.accepted).length === 0}
            >
              Accept Selected ({suggestions.filter((s) => s.accepted).length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
