type ErrorBannerProps = {
  message: string
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return <div className='rounded-md border border-red-200 bg-red-50 p-4 text-red-600'>{message}</div>
}
