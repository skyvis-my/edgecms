import { Skeleton } from '@/components/ui/skeleton'

export function TableSkeleton({ columns = 5, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <div className='rounded-md border'>
      <div className='border-b'>
        <div className='flex h-10 items-center gap-4 px-4'>
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className='h-4 flex-1' />
          ))}
        </div>
      </div>
      <div className='divide-y'>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className='flex items-center gap-4 px-4 py-3'>
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton key={colIndex} className='h-4 flex-1' />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
