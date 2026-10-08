import { SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { AiChatPanel } from '@/features/ai/components/ai-chat-panel'
import { SyncStatusIndicator } from '@/features/sync/components/sync-status-indicator'

/**
 * Standard header actions for authenticated pages
 *
 * Includes:
 * - Sync status indicator
 * - AI chat toggle
 * - Theme switch
 * - Config drawer
 * - Profile dropdown
 */
export function HeaderActions() {
  const [aiChatOpen, setAiChatOpen] = useState(false)

  return (
    <>
      <div className='ms-auto flex items-center space-x-4'>
        <SyncStatusIndicator />
        <Button
          variant='ghost'
          size='icon'
          onClick={() => setAiChatOpen(true)}
          aria-label='Open AI Assistant'
        >
          <SparklesIcon className='size-4' />
        </Button>
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </div>

      <AiChatPanel open={aiChatOpen} onOpenChange={setAiChatOpen} />
    </>
  )
}
