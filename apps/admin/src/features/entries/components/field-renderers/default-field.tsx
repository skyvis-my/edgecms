import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { FieldTypeProps } from './types'

export function DefaultField({
  fieldId,
  name,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
}: FieldTypeProps) {
  const isObject = currentValue !== null && typeof currentValue === 'object'

  const formattedJson = useMemo(() => {
    if (!isObject) return ''
    try {
      return JSON.stringify(currentValue, null, 2)
    } catch {
      return ''
    }
  }, [currentValue, isObject])

  const [rawText, setRawText] = useState(formattedJson)
  const [parseError, setParseError] = useState<string | null>(null)

  useEffect(() => {
    if (isObject) {
      setRawText(formattedJson)
      setParseError(null)
    }
  }, [formattedJson, isObject])

  if (isObject) {
    return (
      <div className='space-y-1.5'>
        <Textarea
          id={fieldId}
          value={rawText}
          onChange={(e) => {
            const val = e.target.value
            setRawText(val)
            if (!val.trim()) {
              setParseError(null)
              onChange(null)
              return
            }
            try {
              const parsed = JSON.parse(val)
              setParseError(null)
              onChange(parsed)
            } catch {
              setParseError('Invalid JSON format')
            }
          }}
          placeholder={`Enter valid JSON for ${name}`}
          rows={6}
          disabled={disabled}
          className='font-mono text-sm'
          aria-invalid={Boolean(error || parseError)}
          aria-describedby={error ? errorId : undefined}
          data-testid={`field-json-${name}`}
        />
        {parseError && (
          <p className='text-xs text-red-500' role='alert'>
            {parseError}
          </p>
        )}
      </div>
    )
  }

  return (
    <Input
      id={fieldId}
      value={String(currentValue ?? '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`Enter ${name}`}
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={error ? errorId : undefined}
    />
  )
}

