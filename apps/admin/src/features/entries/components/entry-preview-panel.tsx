import { type RefObject } from 'react'
import { EyeOff, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CollectionDefinition } from '@/features/collections/api/collections-api'
import { renderContentToHtml } from '@edgecms/client'

type EntryPreviewPanelProps = {
  iframeReady: boolean
  previewView: 'iframe' | 'inspector'
  setPreviewView: (view: 'iframe' | 'inspector') => void
  previewDevice: 'desktop' | 'tablet' | 'mobile'
  setPreviewDevice: (device: 'desktop' | 'tablet' | 'mobile') => void
  computedPreviewUrl: string
  iframeRef: RefObject<HTMLIFrameElement | null>
  onClosePreview: () => void
  previewTargetUrl: string
  setPreviewTargetUrl: (url: string) => void
  previewToken: string | null
  onFetchPreviewToken: () => void
  onIframeLoad: () => void
  slug: string
  status: string
  activeLocale: string
  collection: CollectionDefinition
  entryData?: Record<string, unknown>
}

export function EntryPreviewPanel({
  iframeReady,
  previewView,
  setPreviewView,
  previewDevice,
  setPreviewDevice,
  computedPreviewUrl,
  iframeRef,
  onClosePreview,
  previewTargetUrl,
  setPreviewTargetUrl,
  previewToken,
  onFetchPreviewToken,
  onIframeLoad,
  slug,
  status,
  activeLocale,
  collection,
  entryData,
}: EntryPreviewPanelProps) {
  return (
    <Card className='overflow-hidden border-primary/20 shadow-lg bg-card'>
      {/* Panel Header */}
      <div className='flex items-center justify-between border-b bg-muted/40 px-3 py-2'>
        <div className='flex items-center gap-2'>
          <span className='relative flex size-2'>
            <span
              className={`absolute inline-flex size-full rounded-full opacity-75 ${
                iframeReady ? 'animate-ping bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span
              className={`relative inline-flex size-2 rounded-full ${
                iframeReady ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </span>
          <span className='text-xs font-semibold'>Live Split-Pane Preview</span>
          <Badge
            variant='outline'
            className='text-[10px] py-0 px-1.5 h-4 text-emerald-600 border-emerald-200 bg-emerald-50'
          >
            {iframeReady ? 'Streaming Real-Time' : 'Bridge Active'}
          </Badge>
        </div>

        <div className='flex items-center gap-1.5'>
          {/* Mode switcher: Iframe vs Inspector */}
          <div className='flex items-center rounded-md border bg-background p-0.5 text-xs'>
            <button
              type='button'
              onClick={() => setPreviewView('iframe')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                previewView === 'iframe'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Iframe
            </button>
            <button
              type='button'
              onClick={() => setPreviewView('inspector')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                previewView === 'inspector'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Inspector
            </button>
          </div>

          {/* Device switcher */}
          {previewView === 'iframe' && (
            <div className='flex items-center rounded-md border bg-background p-0.5'>
              <Button
                type='button'
                variant={previewDevice === 'desktop' ? 'secondary' : 'ghost'}
                size='icon'
                className='size-6 rounded-sm'
                onClick={() => setPreviewDevice('desktop')}
                title='Desktop View'
              >
                <Monitor className='size-3.5' />
              </Button>
              <Button
                type='button'
                variant={previewDevice === 'tablet' ? 'secondary' : 'ghost'}
                size='icon'
                className='size-6 rounded-sm'
                onClick={() => setPreviewDevice('tablet')}
                title='Tablet View (768px)'
              >
                <Tablet className='size-3.5' />
              </Button>
              <Button
                type='button'
                variant={previewDevice === 'mobile' ? 'secondary' : 'ghost'}
                size='icon'
                className='size-6 rounded-sm'
                onClick={() => setPreviewDevice('mobile')}
                title='Mobile View (375px)'
              >
                <Smartphone className='size-3.5' />
              </Button>
            </div>
          )}

          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-7'
            onClick={() => {
              if (iframeRef.current) {
                iframeRef.current.src = computedPreviewUrl
              }
            }}
            title='Reload Preview Iframe'
          >
            <RefreshCw className='size-3.5' />
          </Button>

          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='size-7'
            onClick={onClosePreview}
            title='Close Preview'
          >
            <EyeOff className='size-3.5' />
          </Button>
        </div>
      </div>

      {/* Target URL bar */}
      <div className='flex items-center gap-2 border-b bg-muted/20 px-3 py-2'>
        <Label
          htmlFor='preview-target-url'
          className='text-[11px] text-muted-foreground whitespace-nowrap'
        >
          Target URL:
        </Label>
        <Input
          id='preview-target-url'
          value={previewTargetUrl}
          onChange={(e) => setPreviewTargetUrl(e.target.value)}
          className='h-7 text-xs bg-background'
          placeholder='http://localhost:3000/preview'
        />
        {previewToken ? (
          <Badge
            variant='outline'
            className='text-[10px] font-mono shrink-0 text-emerald-600 bg-emerald-50'
            title={previewToken}
          >
            Token Signed
          </Badge>
        ) : (
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 text-[11px] shrink-0'
            onClick={onFetchPreviewToken}
          >
            Get Token
          </Button>
        )}
      </div>

      {/* Preview Content */}
      {previewView === 'iframe' ? (
        <div className='p-3 bg-muted/10 flex justify-center min-h-[620px]'>
          <div
            className={`transition-all duration-200 border rounded-lg shadow-inner overflow-hidden bg-white ${
              previewDevice === 'mobile'
                ? 'w-[375px]'
                : previewDevice === 'tablet'
                  ? 'w-[768px]'
                  : 'w-full'
            }`}
          >
            <iframe
              ref={iframeRef}
              src={computedPreviewUrl}
              className='w-full h-[620px] border-0'
              title='Live Split-Pane Draft Preview'
              data-testid='live-preview-iframe'
              onLoad={onIframeLoad}
            />
          </div>
        </div>
      ) : (
        <div className='p-4 space-y-4 max-h-[620px] overflow-y-auto bg-background'>
          <div className='border-b pb-3 space-y-1'>
            <div className='flex items-center justify-between'>
              <h3 className='text-sm font-semibold truncate'>
                {slug || 'Untitled Entry'}
              </h3>
              <Badge variant='secondary' className='text-xs'>
                {status}
              </Badge>
            </div>
            <p className='text-xs text-muted-foreground'>
              Locale: {activeLocale} • Collection: {collection.name} ({collection.slug})
            </p>
          </div>

          <div className='space-y-3'>
            <h4 className='text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
              Live Draft Data
            </h4>
            {collection.fields.map((field) => {
              const val = entryData?.[field.name]
              if (val === undefined || val === null || val === '') return null

              return (
                <div key={field.name} className='border rounded-md p-3 space-y-1.5 bg-muted/10'>
                  <div className='flex items-center justify-between'>
                    <span className='text-xs font-medium'>{field.name}</span>
                    <Badge variant='outline' className='text-[10px]'>
                      {field.type}
                    </Badge>
                  </div>
                  {field.type === 'richtext' ? (
                    <div
                      className='prose prose-sm max-w-none text-xs'
                      dangerouslySetInnerHTML={{ __html: renderContentToHtml(val) }}
                    />
                  ) : typeof val === 'object' ? (
                    <pre className='text-[11px] bg-muted/40 p-2 rounded overflow-x-auto'>
                      {JSON.stringify(val, null, 2)}
                    </pre>
                  ) : (
                    <p className='text-xs'>{String(val)}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}
