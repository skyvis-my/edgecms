import type { ComponentType } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface ServiceRow {
  key: string
  name: string
  owner: string
  binding: string
  icon: ComponentType<{ className?: string }>
  subsystem: unknown
  detail: string
  status: string
  latencyLabel: string | null
  latencyMs: number | null
}

export interface ServiceMatrixCardProps {
  serviceRows: ServiceRow[]
  degradedServicesCount: number
  healthLoading: boolean
  getStatusTone: (status: string) => string
  getStatusBadgeVariant: (status: string) => 'default' | 'secondary' | 'destructive'
  getServiceAction: (status: string) => string
}

export function ServiceMatrixCard({
  serviceRows,
  degradedServicesCount,
  healthLoading,
  getStatusTone,
  getStatusBadgeVariant,
  getServiceAction,
}: ServiceMatrixCardProps) {
  return (
    <Card>
      <CardHeader className='flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <CardTitle className='text-base'>Service Matrix</CardTitle>
          <p className='text-sm text-muted-foreground'>
            Live health from the Worker runtime probes.
          </p>
        </div>
        <Badge variant={degradedServicesCount === 0 ? 'default' : 'destructive'}>
          {degradedServicesCount === 0 ? 'All clear' : `${degradedServicesCount} flagged`}
        </Badge>
      </CardHeader>
      <CardContent>
        {healthLoading ? (
          <div className='space-y-3'>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className='h-10 w-full' />
            ))}
          </div>
        ) : (
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Binding</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceRows.map((service) => {
                  const Icon = service.icon
                  return (
                    <TableRow key={service.key}>
                      <TableCell>
                        <div className='flex items-start gap-3'>
                          <Icon className={cn('mt-0.5 h-4 w-4', getStatusTone(service.status))} />
                          <div>
                            <div className='font-medium'>{service.name}</div>
                            <div className='text-xs text-muted-foreground'>
                              {service.owner} - {service.detail}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(service.status)} className='capitalize'>
                          {service.status}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-sm'>
                        {service.latencyLabel ?? 'Probe only'}
                      </TableCell>
                      <TableCell>
                        <code className='rounded bg-muted px-2 py-0.5 text-xs'>
                          {service.binding}
                        </code>
                      </TableCell>
                      <TableCell className='text-sm text-muted-foreground'>
                        {getServiceAction(service.status)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
