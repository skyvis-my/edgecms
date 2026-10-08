import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { Alert, AlertDescription, AlertTitle } from './alert'
import { Avatar, AvatarFallback } from './avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
import { Textarea } from './textarea'

describe('ui primitive wrappers', () => {
  it('renders alert with title and description slots', () => {
    render(
      <Alert variant='destructive' data-testid='alert'>
        <AlertTitle>Danger</AlertTitle>
        <AlertDescription>Something broke</AlertDescription>
      </Alert>
    )

    const alert = screen.getByTestId('alert')
    expect(alert).toHaveAttribute('data-slot', 'alert')
    expect(screen.getByText('Danger')).toHaveAttribute('data-slot', 'alert-title')
    expect(screen.getByText('Something broke')).toHaveAttribute('data-slot', 'alert-description')
  })

  it('renders avatar image/fallback slots', () => {
    render(
      <Avatar data-testid='avatar'>
        <AvatarFallback>NC</AvatarFallback>
      </Avatar>
    )

    expect(screen.getByTestId('avatar')).toHaveAttribute('data-slot', 'avatar')
    expect(screen.getByText('NC')).toHaveAttribute('data-slot', 'avatar-fallback')
  })

  it('renders textarea slot and forwards props', () => {
    render(<Textarea aria-label='Notes' disabled defaultValue='memo' />)

    const textarea = screen.getByRole('textbox', { name: 'Notes' })
    expect(textarea).toHaveAttribute('data-slot', 'textarea')
    expect(textarea).toBeDisabled()
    expect(textarea).toHaveValue('memo')
  })

  it('renders tabs primitives with list, trigger, and content slots', () => {
    render(
      <Tabs defaultValue='a'>
        <TabsList>
          <TabsTrigger value='a'>Tab A</TabsTrigger>
          <TabsTrigger value='b'>Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value='a'>Panel A</TabsContent>
        <TabsContent value='b'>Panel B</TabsContent>
      </Tabs>
    )

    expect(screen.getByRole('tablist')).toHaveAttribute('data-slot', 'tabs-list')
    expect(screen.getByRole('tab', { name: 'Tab A' })).toHaveAttribute('data-slot', 'tabs-trigger')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-slot', 'tabs-content')
    expect(screen.getByText('Panel A')).toBeInTheDocument()
  })
})
