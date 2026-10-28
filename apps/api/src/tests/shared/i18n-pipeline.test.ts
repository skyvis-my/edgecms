import { describe, expect, it } from 'bun:test'
import { computeFallbackChain, flattenLocaleFields } from '../../shared/locale'
import {
  reconstructTipTapNodesFromShielded,
  serializeTipTapWithShielding,
} from '../../shared/tiptap-serializer'

describe('Domain 4: Advanced i18n & Translation Pipelines', () => {
  describe('computeFallbackChain', () => {
    it('builds hierarchical BCP 47 fallback chain with base tag', () => {
      const chain = computeFallbackChain('fr-CA', 'en')
      expect(chain).toEqual(['fr-CA', 'fr', 'en'])
    })

    it('respects custom regional fallback mappings', () => {
      const chain = computeFallbackChain('fr-CA', 'en', {
        'fr-CA': ['fr-FR'],
      })
      expect(chain).toEqual(['fr-CA', 'fr-FR', 'fr', 'en'])
    })

    it('deduplicates when target is already default locale', () => {
      const chain = computeFallbackChain('en', 'en')
      expect(chain).toEqual(['en'])
    })
  })

  describe('flattenLocaleFields with hierarchical fallback', () => {
    it('falls back through chain to find closest regional match before default', () => {
      const data = {
        title: {
          'fr-FR': 'Titre Français',
          en: 'English Title',
        },
      }
      const fields = [{ name: 'title', localizable: true }]

      // When requesting fr-CA with fr-FR in fallback mapping, it should find fr-FR
      const flattened = flattenLocaleFields(data, fields, 'fr-CA', 'en', {
        'fr-CA': ['fr-FR'],
      })

      expect(flattened.title).toBe('Titre Français')
    })
  })

  describe('TipTap Delimiter-Shielding Serializer', () => {
    it('serializes text with marks into delimited unicode tokens and restores them', () => {
      const ast = {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Cloudflare Workers with ' },
          {
            type: 'text',
            text: 'zero latency',
            marks: [{ type: 'bold' }],
          },
          { type: 'text', text: ' and ' },
          {
            type: 'text',
            text: 'instant cache',
            marks: [{ type: 'link', attrs: { href: 'https://cloudflare.com' } }],
          },
          { type: 'text', text: '.' },
        ],
      }

      const { text, marksMap } = serializeTipTapWithShielding(ast)
      expect(text).toContain('⟦m:0⟧zero latency⟦/m:0⟧')
      expect(text).toContain('⟦m:1⟧instant cache⟦/m:1⟧')

      // Simulated machine translation to Spanish
      const translated = 'Cloudflare Workers con ⟦m:0⟧latencia cero⟦/m:0⟧ y ⟦m:1⟧caché instantánea⟦/m:1⟧.'

      const reconstructed = reconstructTipTapNodesFromShielded(translated, marksMap)

      expect(reconstructed).toHaveLength(5)
      expect(reconstructed[0]?.text).toBe('Cloudflare Workers con ')
      expect(reconstructed[1]?.text).toBe('latencia cero')
      expect(reconstructed[1]?.marks).toEqual([{ type: 'bold' }])
      expect(reconstructed[3]?.text).toBe('caché instantánea')
      expect(reconstructed[3]?.marks).toEqual([{ type: 'link', attrs: { href: 'https://cloudflare.com' } }])
    })
  })
})
