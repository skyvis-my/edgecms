import { useNavigate } from '@tanstack/react-router'
import { SparklesIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import type { CommandEnvelope } from '@/features/commands/command-builder'
import { useDryRunCommand, useExecuteCommand } from '@/features/commands/use-execute-command'
import { getCurrentTenantSlug } from '@/features/tenants/api'
import { useAiCommand } from '../api'

/**
 * Static command definition
 */
type StaticCommand = {
  id: string
  label: string
  keywords: string[]
  action: () => void
}

/**
 * AI-interpreted command result
 */
type AICommandResult = {
  id: string
  label: string
  commands: CommandEnvelope[]
  explanation: string
}

type CommandPaletteProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  enableKeyboardShortcut?: boolean
}

export function CommandPalette({
  open: openProp,
  onOpenChange,
  enableKeyboardShortcut = true,
}: CommandPaletteProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [aiResults, setAiResults] = useState<AICommandResult[]>([])
  const latestAiRequestRef = useRef(0)
  const latestSearchRef = useRef(search)
  const navigate = useNavigate()
  const tenantSlug = getCurrentTenantSlug()
  const tenantBasePath = tenantSlug ? `/tenants/${tenantSlug}` : '/admin/tenants'
  const { mutate: mutateAiCommand, isPending } = useAiCommand()
  const { mutateAsync: executeCommandMutation } = useExecuteCommand()
  const { mutateAsync: dryRunCommandMutation } = useDryRunCommand()
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : uncontrolledOpen

  const setOpen = useCallback(
    (nextOpen: boolean | ((previousOpen: boolean) => boolean)) => {
      const resolvedOpen = typeof nextOpen === 'function' ? nextOpen(open) : nextOpen
      if (!isControlled) {
        setUncontrolledOpen(resolvedOpen)
      }
      onOpenChange?.(resolvedOpen)
    },
    [isControlled, onOpenChange, open]
  )

  useEffect(() => {
    latestSearchRef.current = search
  }, [search])

  // Static commands
  const staticCommands = useMemo<StaticCommand[]>(
    () => [
      {
        id: 'go-collections',
        label: 'Go to Collections',
        keywords: ['go', 'navigate', 'collections'],
        action: () => navigate({ to: `${tenantBasePath}/collections` }),
      },
      {
        id: 'go-entries',
        label: 'Go to Entries',
        keywords: ['go', 'navigate', 'entries'],
        action: () => navigate({ to: `${tenantBasePath}/collections` }),
      },
      {
        id: 'go-webhooks',
        label: 'Go to Webhooks',
        keywords: ['go', 'navigate', 'webhooks'],
        action: () => navigate({ to: `${tenantBasePath}/webhooks` }),
      },
      {
        id: 'go-publishing',
        label: 'Go to Publishing',
        keywords: ['go', 'navigate', 'publishing', 'schedule'],
        action: () => navigate({ to: `${tenantBasePath}/publishing` }),
      },
      {
        id: 'go-media',
        label: 'Go to Media',
        keywords: ['go', 'navigate', 'media', 'gallery', 'assets'],
        action: () => navigate({ to: `${tenantBasePath}/media` }),
      },
      {
        id: 'create-collection',
        label: 'Create Collection',
        keywords: ['create', 'new', 'collection'],
        action: () => navigate({ to: `${tenantBasePath}/collections/create` }),
      },
    ],
    [navigate, tenantBasePath]
  )

  // Filter static commands by search input
  const filteredStaticCommands = useMemo(() => {
    if (!search) return staticCommands

    const searchLower = search.toLowerCase()
    return staticCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(searchLower) ||
        cmd.keywords.some((kw) => kw.toLowerCase().includes(searchLower))
    )
  }, [search, staticCommands])

  // Debounced AI command interpretation
  useEffect(() => {
    // Only trigger AI when there's search input and no static matches
    if (!search || filteredStaticCommands.length > 0) {
      latestAiRequestRef.current += 1
      setAiResults((prev) => (prev.length === 0 ? prev : []))
      return
    }

    const timer = setTimeout(() => {
      const requestId = latestAiRequestRef.current + 1
      latestAiRequestRef.current = requestId
      const requestedPrompt = search
      mutateAiCommand(
        { prompt: requestedPrompt, dryRun: true },
        {
          onSuccess: (data) => {
            if (
              latestAiRequestRef.current !== requestId ||
              latestSearchRef.current !== requestedPrompt
            ) {
              return
            }
            if (data.commands.length > 0) {
              setAiResults([
                {
                  id: `ai-${Date.now()}`,
                  label: data.explanation || requestedPrompt,
                  commands: data.commands,
                  explanation: data.explanation,
                },
              ])
            } else {
              setAiResults((prev) => (prev.length === 0 ? prev : []))
            }
          },
          onError: () => {
            if (
              latestAiRequestRef.current !== requestId ||
              latestSearchRef.current !== requestedPrompt
            ) {
              return
            }
            setAiResults((prev) => (prev.length === 0 ? prev : []))
          },
        }
      )
    }, 500)

    return () => clearTimeout(timer)
  }, [search, filteredStaticCommands.length, mutateAiCommand])

  // Execute command
  const executeCommand = useCallback(
    async (command: StaticCommand | AICommandResult) => {
      if ('action' in command) {
        // Static command
        command.action()
        setOpen(false)
        setSearch('')
        setAiResults([])
        return
      }

      try {
        const dryRunDiffs = await Promise.all(
          command.commands.map(async (envelope) => dryRunCommandMutation(envelope))
        )
        const diffCount = dryRunDiffs.flat().length
        const confirmed = window.confirm(
          `Execute AI command?\n${command.explanation}\n\nPreviewed ${diffCount} field change(s).`
        )
        if (!confirmed) return

        for (const envelope of command.commands) {
          await executeCommandMutation(envelope)
        }
        toast.success('AI command executed')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to execute AI command')
      } finally {
        setOpen(false)
        setSearch('')
        setAiResults([])
      }
    },
    [dryRunCommandMutation, executeCommandMutation]
  )

  // Keyboard shortcut handler
  useEffect(() => {
    if (!enableKeyboardShortcut) return

    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [enableKeyboardShortcut, setOpen])

  // Reset state when closing
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      latestAiRequestRef.current += 1
      setSearch('')
      setAiResults([])
    }
  }, [setOpen])

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder='Type a command or search...'
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>{isPending ? 'Thinking...' : 'No results found.'}</CommandEmpty>

        {filteredStaticCommands.length > 0 && (
          <CommandGroup heading='Commands'>
            {filteredStaticCommands.map((cmd) => (
              <CommandItem
                key={cmd.id}
                value={cmd.id}
                onSelect={() => {
                  void executeCommand(cmd)
                }}
              >
                <span>{cmd.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {aiResults.length > 0 && (
          <CommandGroup heading='AI Suggestions'>
            {aiResults.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                onSelect={() => {
                  void executeCommand(result)
                }}
              >
                <SparklesIcon className='mr-2 h-4 w-4 text-purple-500' />
                <span>{result.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
