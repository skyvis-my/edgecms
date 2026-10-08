import '../../../../test-utils/setup'
import { afterEach, describe, expect, it, mock } from 'bun:test'

const { cleanup, render } = await import('@testing-library/react')
const { LocaleSwitcher } = await import('./locale-switcher')

describe('LocaleSwitcher', () => {
  afterEach(() => {
    cleanup()
  })

  it('marks locales with missing required fields before publish', () => {
    const onLocaleChange = mock()

    const view = render(
      <LocaleSwitcher
        locales={['en', 'ms']}
        defaultLocale='en'
        activeLocale='en'
        onLocaleChange={onLocaleChange}
        missingLocales={{ ms: ['body', 'summary'] }}
      />
    )

    expect(view.getByText('en')).toBeTruthy()
    expect(view.getByText('Default')).toBeTruthy()
    expect(view.getByTitle('Missing translations: body, summary')).toBeTruthy()

    expect(view.getByText('ms')).toBeTruthy()
  })
})
