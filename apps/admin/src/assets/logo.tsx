import type { SVGProps } from 'react'
import { cn } from '@/lib/utils'

// EdgeCMS mark: a frame, the vermilion edge, and the reader.
export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      id='edgecms-logo'
      viewBox='0 0 32 32'
      xmlns='http://www.w3.org/2000/svg'
      height='24'
      width='24'
      fill='none'
      className={cn('size-6', className)}
      {...props}
    >
      <title>EdgeCMS</title>
      <rect x='1' y='1' width='30' height='30' stroke='currentColor' strokeWidth='2' />
      <path d='M1 22 L22 1' stroke='#e2401c' strokeWidth='3' />
      <circle cx='22' cy='22' r='3.5' fill='currentColor' />
    </svg>
  )
}
