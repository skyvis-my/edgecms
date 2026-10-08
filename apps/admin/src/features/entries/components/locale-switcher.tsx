import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

type LocaleSwitcherProps = {
  locales: string[]
  defaultLocale: string
  activeLocale: string
  onLocaleChange: (locale: string) => void
  missingLocales?: Record<string, string[]>
}

/**
 * Locale switcher component for entry forms
 * Displays tabs for switching between supported locales
 * Shows visual indicators for missing translations
 */
export function LocaleSwitcher({
  locales,
  defaultLocale,
  activeLocale,
  onLocaleChange,
  missingLocales = {},
}: LocaleSwitcherProps) {
  return (
    <div className='flex items-center gap-3 pb-4 border-b'>
      <div className='text-sm font-medium text-muted-foreground'>Language:</div>
      <Tabs value={activeLocale} onValueChange={onLocaleChange}>
        <TabsList>
          {locales.map((locale) => {
            const isDefault = locale === defaultLocale
            const hasMissingFields = missingLocales[locale]?.length > 0

            return (
              <TabsTrigger key={locale} value={locale} className='relative'>
                <span className={cn('uppercase', isDefault && 'font-semibold')}>{locale}</span>
                {isDefault && (
                  <Badge variant='outline' className='ml-1.5 h-4 px-1 text-[10px]'>
                    Default
                  </Badge>
                )}
                {hasMissingFields && (
                  <span
                    className='absolute top-1 right-1 w-1.5 h-1.5 bg-orange-500 rounded-full'
                    title={`Missing translations: ${missingLocales[locale].join(', ')}`}
                  />
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>
    </div>
  )
}
