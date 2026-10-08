import { Input } from '@/components/ui/input'
import { AssetPicker } from '@/features/assets/asset-picker'
import type { FieldTypeProps } from './types'

export function MediaField({
  fieldId,
  name,
  currentValue,
  onChange,
  error,
  errorId,
  disabled,
  collectionId,
}: FieldTypeProps) {
  if (typeof currentValue === 'string') {
    return (
      <Input
        id={fieldId}
        value={currentValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder='Legacy media URL'
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      />
    )
  }

  return (
    <AssetPicker
      value={
        currentValue && typeof currentValue === 'object'
          ? (currentValue as { assetId: string; variant?: string })
          : null
      }
      smartKeywords={[
        name,
        collectionId ?? '',
        typeof currentValue === 'string' ? currentValue : '',
      ]}
      onChange={(next) => onChange(next)}
      disabled={disabled}
    />
  )
}
