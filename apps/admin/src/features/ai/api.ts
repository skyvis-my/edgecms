import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CommandEnvelope } from '@/features/commands/command-builder'
import type { CommandResult } from '@/features/commands/use-execute-command'
import { edenGet, edenPatch, edenPost, edenPostMultipart } from '@/lib/eden-client'

/**
 * Request payload for AI command generation
 */
export type AiCommandRequest = {
  prompt: string
  context?: {
    collectionSlug?: string
    entryId?: string
  }
  dryRun?: boolean
}

/**
 * Response from AI command generation
 */
export type AiCommandResponse = {
  commands: CommandEnvelope[]
  explanation: string
  results?: CommandResult[]
}

export type AiWorkflowRequest = {
  workflow: 'bulk_update' | 'bulk_localization' | 'transaction_builder'
  prompt: string
  context?: {
    collectionSlug?: string
    entryId?: string
  }
}

export type AiWorkflowStep = {
  id: string
  label?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export type AiWorkflowResponse = {
  workflow: string
  explanation: string
  commands: CommandEnvelope[]
  steps: AiWorkflowStep[]
}

/**
 * Hook to generate commands from natural language prompt
 *
 * Posts to `/api/admin/ai/command` and returns:
 * - commands: Array of command envelopes to preview/execute
 * - explanation: Human-readable explanation of what the AI understood
 * - results: (Optional) If dryRun=false, the execution results
 */
export function useAiCommand() {
  return useMutation({
    mutationFn: async (request: AiCommandRequest): Promise<AiCommandResponse> => {
      return edenPost<AiCommandResponse>('/admin/ai/command', request)
    },
    onError: (error: Error) => {
      toast.error(`AI command failed: ${error.message}`)
    },
  })
}

export function useAiWorkflow() {
  return useMutation({
    mutationFn: async (request: AiWorkflowRequest): Promise<AiWorkflowResponse> => {
      return edenPost<AiWorkflowResponse>('/admin/ai/workflow', request)
    },
    onError: (error: Error) => {
      toast.error(`AI workflow failed: ${error.message}`)
    },
  })
}

export type AiImportBatch = {
  id: string
  status: 'draft' | 'extracting' | 'ready_for_review' | 'failed' | 'applied' | 'cancelled'
  intent: string
  targetCollectionSlug?: string | null
  targetEntryId?: string | null
  sourceLocale?: string | null
  targetLocalesJson?: string[] | null
  sourceCount: number
}

export type AiImportSource = {
  id: string
  kind: 'text' | 'file' | 'asset'
  filename?: string | null
  contentType?: string | null
  sizeBytes?: number | null
  extractionStatus: 'pending' | 'ready' | 'failed' | 'unsupported'
  extractedText?: string | null
}

export type AiSuggestion = {
  id: string
  status: 'pending' | 'accepted' | 'rejected' | 'warning'
  operation: 'create_entry' | 'update_entry' | 'manual'
  targetCollectionSlug?: string | null
  targetEntryId?: string | null
  fieldPath?: string | null
  locale?: string | null
  sourceLocale?: string | null
  suggestedValueJson?: unknown
  editedValueJson?: unknown
  confidence: number
  citationsJson?: Array<{
    id: string
    sourceType: string
    label: string
    snippet?: string
    score?: number
  }> | null
  warning?: string | null
}

export type AiSuggestionSet = {
  id: string
  status: 'generating' | 'ready' | 'failed' | 'dry_run_ready' | 'applied'
  dryRunHash?: string | null
}

export type AiImportBatchDetail = {
  batch: AiImportBatch
  sources: AiImportSource[]
  suggestionSet?: AiSuggestionSet | null
  suggestions: { rows: AiSuggestion[]; total: number }
  localeMatrix: { sourceLocale: string; targetLocales: string[] }
  warnings: string[]
}

export type AiImportDryRunResponse = {
  commands: CommandEnvelope[]
  commandResults: CommandResult[]
  validationErrors: string[]
  dryRunHash: string
}

export function useCreateImportBatch() {
  return useMutation({
    mutationFn: async (request: {
      intent: string
      targetCollectionSlug?: string
      targetEntryId?: string
      sourceLocale?: string
      targetLocales?: string[]
    }): Promise<{ batch: AiImportBatch }> => edenPost('/admin/ai/import-batches', request),
    onError: (error: Error) => toast.error(`Import batch failed: ${error.message}`),
  })
}

export function useUploadImportSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request: {
      batchId: string
      text?: string
      file?: File
    }): Promise<{ source: AiImportSource }> => {
      if (request.file) {
        const form = new FormData()
        form.append('file', request.file)
        return edenPostMultipart(`/admin/ai/import-batches/${request.batchId}/sources`, form)
      }
      return edenPost(`/admin/ai/import-batches/${request.batchId}/sources`, {
        kind: 'text',
        text: request.text ?? '',
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ai-import-batch', variables.batchId] })
    },
    onError: (error: Error) => toast.error(`Source upload failed: ${error.message}`),
  })
}

export function useAnalyzeImportBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (batchId: string): Promise<{ suggestionSetId: string; status: string }> =>
      edenPost(`/admin/ai/import-batches/${batchId}/analyze`, {}),
    onSuccess: (_data, batchId) => {
      queryClient.invalidateQueries({ queryKey: ['ai-import-batch', batchId] })
    },
    onError: (error: Error) => toast.error(`Analysis failed: ${error.message}`),
  })
}

export function useImportBatch(batchId?: string) {
  return useQuery({
    queryKey: ['ai-import-batch', batchId],
    queryFn: async (): Promise<AiImportBatchDetail> => {
      if (!batchId) throw new Error('Batch id is required')
      return edenGet(`/admin/ai/import-batches/${batchId}`)
    },
    enabled: Boolean(batchId),
  })
}

export function useUpdateSuggestion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request: {
      suggestionId: string
      batchId: string
      status?: 'pending' | 'accepted' | 'rejected'
      editedValue?: unknown
    }): Promise<{ suggestion: AiSuggestion }> =>
      edenPatch(`/admin/ai/suggestions/${request.suggestionId}`, {
        status: request.status,
        editedValue: request.editedValue,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ai-import-batch', variables.batchId] })
    },
    onError: (error: Error) => toast.error(`Suggestion update failed: ${error.message}`),
  })
}

export function useDryRunSuggestionSet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request: {
      suggestionSetId: string
      batchId: string
    }): Promise<AiImportDryRunResponse> => edenPost(`/admin/ai/suggestion-sets/${request.suggestionSetId}/dry-run`, {}),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ai-import-batch', variables.batchId] })
    },
    onError: (error: Error) => toast.error(`Dry-run failed: ${error.message}`),
  })
}

export function useApplySuggestionSet() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (request: {
      suggestionSetId: string
      batchId: string
      dryRunHash: string
    }): Promise<{ status: string; commandResults: CommandResult[] }> =>
      edenPost(`/admin/ai/suggestion-sets/${request.suggestionSetId}/apply`, {
        dryRunHash: request.dryRunHash,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ai-import-batch', variables.batchId] })
    },
    onError: (error: Error) => toast.error(`Apply failed: ${error.message}`),
  })
}
