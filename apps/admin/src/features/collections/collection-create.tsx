import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { CollectionForm } from './components/collection-form'

type CollectionCreateProps = {
  kind: 'collection' | 'singleton'
}

export function CollectionCreate({ kind }: CollectionCreateProps) {
  const isSingleton = kind === 'singleton'
  const { tenantSlug } = useParams({ strict: false }) as { tenantSlug?: string }
  const backPath = tenantSlug ? `/tenants/${tenantSlug}/collections` : '/admin/tenants'

  return (
    <>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='ghost' size='icon' asChild>
            <Link to={backPath}>
              <ArrowLeft className='size-4' />
              <span className='sr-only'>Back to collections</span>
            </Link>
          </Button>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              {isSingleton ? 'Create Singleton' : 'Create Collection'}
            </h2>
            <p className='text-muted-foreground'>
              {isSingleton
                ? 'Define a single-entry content type for your CMS'
                : 'Define a new content type for your CMS'}
            </p>
          </div>
        </div>

        <CollectionForm mode='create' createSingleton={isSingleton} />
      </Main>
    </>
  )
}
