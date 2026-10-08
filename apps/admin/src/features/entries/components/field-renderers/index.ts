import type { ComponentType } from 'react'
import type { ArrayItemSubfield } from '@/features/entries/components/field-renderer-utils'
import { ArrayField } from './array-field'
import { BooleanField } from './boolean-field'
import { ColorField } from './color-field'
import { DateField } from './date-field'
import { DefaultField } from './default-field'
import { EmailField } from './email-field'
import { JsonField } from './json-field'
import { MarkdownField } from './markdown-field'
import { MediaField } from './media-field'
import { NumberField } from './number-field'
import { RelationFieldWrapper } from './relation-field-wrapper'
import { RichTextField, TextField } from './text-field'
import { SelectField } from './select-field'
import { SlugField } from './slug-field'
import type { FieldTypeProps } from './types'
import { UrlField } from './url-field'

export type { FieldTypeProps } from './types'

export type FieldRendererMap = Record<
  string,
  ComponentType<FieldTypeProps & { itemSubfields?: ArrayItemSubfield[] }>
>

export const FIELD_RENDERERS: FieldRendererMap = {
  text: TextField,
  richtext: RichTextField,
  markdown: MarkdownField,
  number: NumberField,
  boolean: BooleanField,
  date: DateField,
  media: MediaField,
  relation: RelationFieldWrapper,
  json: JsonField,
  array: ArrayField as FieldRendererMap[string],
  select: SelectField,
  email: EmailField,
  url: UrlField,
  slug: SlugField,
  color: ColorField,
  default: DefaultField,
}
