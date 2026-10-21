import { ContentSection } from '../components/content-section'
import { AccountForm } from './account-form'
import { PersonalDataSection } from './personal-data-section'

export function SettingsAccount() {
  return (
    <ContentSection
      title='Account'
      desc='Update your account settings. Set your preferred language and
          timezone.'
    >
      <div className='space-y-8'>
        <AccountForm />
        <PersonalDataSection />
      </div>
    </ContentSection>
  )
}
