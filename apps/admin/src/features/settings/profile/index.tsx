import { ContentSection } from '../components/content-section'
import { ProfileForm } from './profile-form'
import { TwoFactorSettings } from './two-factor-settings'

export function SettingsProfile() {
  return (
    <ContentSection title='Profile' desc='This is how others will see you on the site.'>
      <div className='grid gap-8'>
        <TwoFactorSettings />
        <ProfileForm />
      </div>
    </ContentSection>
  )
}
