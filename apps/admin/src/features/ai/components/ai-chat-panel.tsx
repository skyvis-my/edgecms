import { useParams } from '@tanstack/react-router'
import { Loader2Icon, SendIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { logger } from '@/lib/logger'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { CommandEnvelope } from '@/features/commands/command-builder'
import type { CommandResult } from '@/features/commands/use-execute-command'
import { type AiWorkflowStep, useAiCommand } from '../api'
import { WorkflowPanel } from '../workflows/workflow-panel'

/**
 * Message in the conversation history
 */
type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  commands?: CommandEnvelope[]
  results?: CommandResult[]
  workflowSteps?: AiWorkflowStep[]
  timestamp: Date
  originalPrompt?: string // Track the user prompt that generated this AI response
}

type AiChatPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * AI Chat Panel Component
 *
 * A slide-over panel that provides a conversational AI assistant for
 * natural language content operations.
 */
export function AiChatPanel({ open, onOpenChange }: AiChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Get current route context
  const params = useParams({ strict: false })
  const collectionSlug = params.collectionId as string | undefined
  const entryId = params.entryId as string | undefined

  // Compute context for display and API calls
  const context =
    collectionSlug || entryId
      ? {
          collectionSlug,
          entryId,
        }
      : undefined

  const aiCommand = useAiCommand()

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  // Clear messages when panel closes
  useEffect(() => {
    if (!open) {
      setMessages([])
      setInput('')
    }
  }, [open])

  const handleSend = async () => {
    if (!input.trim() || aiCommand.isPending) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')

    try {
      const response = await aiCommand.mutateAsync({
        prompt: userMessage.content,
        context,
        dryRun: true, // Start with preview
      })

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.explanation,
        commands: response.commands,
        workflowSteps: [
          {
            id: 'preview-generated',
            label: 'Generate command preview',
            status: 'completed',
          },
          {
            id: 'ready-for-execution',
            label: 'Ready for execution',
            status: 'pending',
          },
        ],
        timestamp: new Date(),
        originalPrompt: userMessage.content, // Store the user's prompt for re-execution
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      // Error already handled by mutation onError
      logger.error('AI command error:', error)
    }
  }

  const handleExecute = async (messageId: string) => {
    const message = messages.find((msg) => msg.id === messageId)
    if (!message || !message.commands || message.commands.length === 0 || !message.originalPrompt)
      return

    try {
      const response = await aiCommand.mutateAsync({
        prompt: message.originalPrompt, // Use the original user prompt
        context,
        dryRun: false, // Execute for real
      })

      // Update message with execution results
      setMessages((prev) =>
        prev.map((msg, _idx) =>
          msg.id === messageId
            ? {
                ...msg,
                results: response.results,
              }
            : msg
        )
      )
    } catch (error) {
      logger.error('Command execution error:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='w-full sm:max-w-lg flex flex-col'>
        <SheetHeader>
          <SheetTitle className='flex items-center gap-2'>
            <SparklesIcon className='size-5' />
            AI Assistant
          </SheetTitle>
          <SheetDescription>
            Ask me to create, update, or manage your content using natural language.
            {context && (
              <span className='block mt-1 text-xs'>
                Context: {collectionSlug && `Collection: ${collectionSlug}`}
                {entryId && ` • Entry: ${entryId}`}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Messages Area */}
        <div className='flex-1 overflow-y-auto space-y-4 py-4'>
          {messages.length === 0 && (
            <div className='flex items-center justify-center h-full text-center text-muted-foreground text-sm'>
              <div>
                <SparklesIcon className='size-8 mx-auto mb-2 opacity-50' />
                <p>Start a conversation with the AI assistant</p>
                <p className='text-xs mt-1'>
                  Try "Create a blog post about AI" or "Update this entry's title"
                </p>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onExecute={() => handleExecute(message.id)}
              isExecuting={aiCommand.isPending}
            />
          ))}

          {aiCommand.isPending && (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2Icon className='size-4 animate-spin' />
              <span>AI is thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className='flex gap-2 pt-4 border-t'>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Type your message...'
            disabled={aiCommand.isPending}
            className='flex-1'
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || aiCommand.isPending}
            size='icon'
            aria-label='Send message'
          >
            <SendIcon className='size-4' />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Individual message bubble component
 */
function MessageBubble({
  message,
  onExecute,
  isExecuting,
}: {
  message: Message
  onExecute: () => void
  isExecuting: boolean
}) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] space-y-2 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Message Content */}
        <div
          className={`rounded-lg px-4 py-2 ${
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          <p className='text-sm whitespace-pre-wrap'>{message.content}</p>
        </div>

        {/* Commands Preview */}
        {message.commands && message.commands.length > 0 && (
          <div className='w-full space-y-2'>
            <p className='text-xs text-muted-foreground'>Generated commands:</p>
            {message.commands.map((cmd) => (
              <CommandCard
                key={`${cmd.type}-${cmd.timestamp}-${JSON.stringify(cmd.payload)}`}
                command={cmd}
              />
            ))}

            {/* Execute Button (only if not executed yet) */}
            {!message.results && (
              <div className='flex gap-2'>
                <Button onClick={onExecute} disabled={isExecuting} size='sm'>
                  {isExecuting ? (
                    <>
                      <Loader2Icon className='size-3 animate-spin' />
                      Executing...
                    </>
                  ) : (
                    'Execute'
                  )}
                </Button>
                <Button variant='outline' size='sm' disabled={isExecuting}>
                  Cancel
                </Button>
              </div>
            )}

            {message.workflowSteps && message.workflowSteps.length > 0 && (
              <WorkflowPanel steps={message.workflowSteps} />
            )}
          </div>
        )}

        {/* Execution Results */}
        {message.results && message.results.length > 0 && (
          <div className='w-full space-y-2'>
            <p className='text-xs text-muted-foreground'>Execution results:</p>
            {message.results.map((result) => (
              <ResultCard key={result.commandId} result={result} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <p className='text-xs text-muted-foreground'>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

/**
 * Command preview card
 */
function CommandCard({ command }: { command: CommandEnvelope }) {
  return (
    <Card className='py-3'>
      <CardContent className='p-0 px-4'>
        <div className='flex items-center gap-2'>
          <div className='flex-1'>
            <p className='font-medium text-sm'>{formatCommandType(command.type)}</p>
            <p className='text-xs text-muted-foreground'>{formatCommandSummary(command)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Execution result card
 */
function ResultCard({ result }: { result: CommandResult }) {
  const isSuccess = result.status === 'success'

  return (
    <Card className={`py-3 ${isSuccess ? 'border-green-500/50' : 'border-red-500/50'}`}>
      <CardContent className='p-0 px-4'>
        <div className='flex items-center gap-2'>
          <div className={`size-2 rounded-full ${isSuccess ? 'bg-green-500' : 'bg-red-500'}`} />
          <div className='flex-1'>
            <p className='font-medium text-sm'>{formatCommandType(result.type)}</p>
            <p className='text-xs text-muted-foreground'>
              {isSuccess ? 'Executed successfully' : 'Execution failed'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Format command type for display
 */
function formatCommandType(type: string): string {
  return type
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

/**
 * Format command summary from payload
 */
function formatCommandSummary(command: CommandEnvelope): string {
  const { type, payload } = command

  switch (type) {
    case 'createEntry':
      return `Create entry in collection ${payload.collectionId || 'unknown'}`
    case 'updateEntry':
      return `Update entry ${payload.entryId || 'unknown'}`
    case 'deleteEntry':
      return `Delete entry ${payload.entryId || 'unknown'}`
    case 'linkRelation':
      return `Link ${payload.sourceEntryId || 'entry'} to ${payload.targetEntryId || 'entry'}`
    case 'unlinkRelation':
      return 'Unlink relation between entries'
    case 'publishNow':
      return `Publish entry ${payload.entryId || 'unknown'}`
    case 'unpublishNow':
      return `Unpublish entry ${payload.entryId || 'unknown'}`
    default:
      return JSON.stringify(payload).slice(0, 50)
  }
}
