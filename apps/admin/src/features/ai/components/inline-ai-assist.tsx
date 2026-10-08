import { Check, ChevronDown, ChevronUp, Loader2, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAiCommand } from '../api'
import { logger } from '@/lib/logger'

type InlineAiAssistProps = {
  fieldName: string
  fieldType: string
  currentValue: unknown
  collectionSlug: string
  siblingValues: Record<string, unknown>
  onAcceptSuggestion: (value: unknown) => void
  entryId?: string
}

/**
 * Inline AI assist button that appears next to entry fields
 * Provides AI-powered suggestions for field values
 */
export function InlineAiAssist({
  fieldName,
  fieldType,
  currentValue: _currentValue,
  collectionSlug,
  siblingValues,
  onAcceptSuggestion,
  entryId,
}: InlineAiAssistProps) {
  const [suggestion, setSuggestion] = useState<unknown>(null)
  const [showSuggestion, setShowSuggestion] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const aiCommandMutation = useAiCommand()

  const handleRequestSuggestion = async () => {
    // Build context for AI
    const otherFields = Object.entries(siblingValues)
      .filter(([key]) => key !== fieldName)
      .reduce(
        (acc, [key, value]) => {
          acc[key] = value
          return acc
        },
        {} as Record<string, unknown>
      )

    const prompt = `Suggest a value for the '${fieldName}' field (type: ${fieldType}) in the '${collectionSlug}' collection. Other fields: ${JSON.stringify(otherFields, null, 2)}`

    try {
      const response = await aiCommandMutation.mutateAsync({
        prompt,
        context: {
          collectionSlug,
          entryId,
        },
        dryRun: true,
      })

      // Extract the suggested value from the AI response
      // The AI might return an updateEntry command with the field value
      const updateCommand = response.commands.find(
        (cmd) => cmd.type === 'updateEntry' || cmd.type === 'createEntry'
      )

      if (updateCommand?.payload?.data) {
        const suggestedValue = (updateCommand.payload.data as Record<string, unknown>)[fieldName]
        if (suggestedValue !== undefined) {
          setSuggestion(suggestedValue)
          setShowSuggestion(true)
        }
      }
    } catch (error) {
      logger.error('AI suggestion error:', error)
    }
  }

  const handleAccept = () => {
    if (suggestion !== null) {
      onAcceptSuggestion(suggestion)
      setShowSuggestion(false)
      setSuggestion(null)
    }
  }

  const handleReject = () => {
    setShowSuggestion(false)
    setSuggestion(null)
  }

  const isLoading = aiCommandMutation.isPending

  return (
    <div className='relative inline-block'>
      <Button
        type='button'
        variant='ghost'
        size='sm'
        className='h-6 w-6 p-0 hover:bg-accent'
        onClick={handleRequestSuggestion}
        disabled={isLoading}
        title='AI Suggest'
      >
        {isLoading ? (
          <Loader2 className='h-3.5 w-3.5 animate-spin text-muted-foreground' />
        ) : (
          <Sparkles className='h-3.5 w-3.5 text-muted-foreground hover:text-purple-500' />
        )}
      </Button>

      {showSuggestion && (
        <div className='mt-2 p-3 border rounded-md bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800 animate-in slide-in-from-top-2'>
          <div className='flex items-start justify-between gap-2'>
            <div className='flex-1 min-w-0'>
              <p className='text-xs font-medium text-purple-700 dark:text-purple-300 mb-1'>
                AI Suggestion
              </p>
              <p className='text-sm break-words'>
                {typeof suggestion === 'string' && suggestion.length > 100 && !expanded ? (
                  <>
                    {suggestion.slice(0, 100)}...
                    <button
                      type='button'
                      className='inline-flex items-center gap-0.5 text-purple-600 dark:text-purple-400 underline ml-1'
                      onClick={() => setExpanded(true)}
                    >
                      Show more
                      <ChevronDown className='h-3 w-3' />
                    </button>
                  </>
                ) : typeof suggestion === 'string' && suggestion.length > 100 && expanded ? (
                  <>
                    {suggestion}
                    <button
                      type='button'
                      className='inline-flex items-center gap-0.5 text-purple-600 dark:text-purple-400 underline ml-1'
                      onClick={() => setExpanded(false)}
                    >
                      Show less
                      <ChevronUp className='h-3 w-3' />
                    </button>
                  </>
                ) : (
                  String(suggestion)
                )}
              </p>
            </div>
            <div className='flex gap-1 flex-shrink-0'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-7 w-7 p-0 hover:bg-purple-200 dark:hover:bg-purple-900'
                onClick={handleAccept}
                title='Accept suggestion'
              >
                <Check className='h-3.5 w-3.5 text-green-600 dark:text-green-400' />
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-7 w-7 p-0 hover:bg-purple-200 dark:hover:bg-purple-900'
                onClick={handleReject}
                title='Reject suggestion'
              >
                <X className='h-3.5 w-3.5 text-red-600 dark:text-red-400' />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
