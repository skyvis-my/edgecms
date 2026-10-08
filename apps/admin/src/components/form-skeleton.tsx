import { Skeleton } from '@/components/ui/skeleton'

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className='space-y-6'>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className='space-y-2'>
          <Skeleton className='h-4 w-24' />
          <Skeleton className='h-10 w-full' />
        </div>
      ))}
      <div className='flex justify-end gap-2'>
        <Skeleton className='h-10 w-20' />
        <Skeleton className='h-10 w-20' />
      </div>
    </div>
  )
}
