import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export type WorkflowStep = {
  id: string
  label?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export type WorkflowHistoryItem = {
  id: string
  workflow: string
  finishedAt: string
  commandCount: number
}

type WorkflowPanelProps = {
  steps: WorkflowStep[]
  history?: WorkflowHistoryItem[]
}

function getStatusIcon(status: WorkflowStep['status']) {
  if (status === 'running') {
    return <Loader2 className='size-3 animate-spin' />
  }
  if (status === 'completed') {
    return <CheckCircle2 className='size-3' />
  }
  if (status === 'failed') {
    return <XCircle className='size-3' />
  }
  return <CircleDashed className='size-3' />
}

export function WorkflowPanel({ steps, history = [] }: WorkflowPanelProps) {
  return (
    <Card className='py-3'>
      <CardHeader className='px-4 pb-1'>
        <CardTitle className='text-sm'>Workflow progress</CardTitle>
      </CardHeader>
      <CardContent className='px-4 space-y-3'>
        <div className='space-y-2'>
          {steps.length === 0 && <p className='text-xs text-muted-foreground'>No active workflow.</p>}
          {steps.map((step) => (
            <div key={step.id} className='flex items-center justify-between gap-2 text-xs'>
              <span>{step.label ?? step.id}</span>
              <Badge variant={step.status === 'failed' ? 'destructive' : 'secondary'}>
                <span className='inline-flex items-center gap-1'>
                  {getStatusIcon(step.status)}
                  {step.status}
                </span>
              </Badge>
            </div>
          ))}
        </div>

        {history.length > 0 && (
          <div className='space-y-1 pt-1 border-t'>
            <p className='text-xs text-muted-foreground'>Recent runs</p>
            {history.map((item) => (
              <div key={item.id} className='text-xs text-muted-foreground'>
                {item.workflow} · {item.commandCount} commands
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
