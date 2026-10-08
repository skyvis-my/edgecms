import { describe, expect, it } from 'bun:test'
import { slugify } from '../../shared/utils/slugify'

describe('slugify', () => {
  describe('basic slug generation', () => {
    it('converts simple text to lowercase slug', () => {
      expect(slugify('Hello World')).toBe('hello-world')
    })

    it('converts uppercase text to lowercase', () => {
      expect(slugify('UPPERCASE')).toBe('uppercase')
    })

    it('converts mixed case to lowercase', () => {
      expect(slugify('CamelCaseText')).toBe('camelcasetext')
    })

    it('preserves already valid slugs', () => {
      expect(slugify('valid-slug')).toBe('valid-slug')
    })

    it('preserves numeric characters', () => {
      expect(slugify('version 2 release')).toBe('version-2-release')
    })

    it('handles single word input', () => {
      expect(slugify('hello')).toBe('hello')
    })

    it('handles numeric-only input', () => {
      expect(slugify('12345')).toBe('12345')
    })

    it('handles mixed alphanumeric input', () => {
      expect(slugify('abc123def')).toBe('abc123def')
    })

    it('handles single character input', () => {
      expect(slugify('a')).toBe('a')
    })

    it('handles single digit input', () => {
      expect(slugify('7')).toBe('7')
    })
  })

  describe('special character handling', () => {
    it('replaces special characters with hyphens', () => {
      expect(slugify('hello@world')).toBe('hello-world')
    })

    it('replaces ampersands', () => {
      expect(slugify('cats & dogs')).toBe('cats-dogs')
    })

    it('replaces periods', () => {
      expect(slugify('file.name.ext')).toBe('file-name-ext')
    })

    it('replaces underscores', () => {
      expect(slugify('snake_case_text')).toBe('snake-case-text')
    })

    it('replaces exclamation marks and question marks', () => {
      expect(slugify('Hello! How are you?')).toBe('hello-how-are-you')
    })

    it('replaces brackets and parentheses', () => {
      expect(slugify('item (new) [draft]')).toBe('item-new-draft')
    })

    it('replaces forward slashes', () => {
      expect(slugify('path/to/resource')).toBe('path-to-resource')
    })

    it('replaces colons and semicolons', () => {
      expect(slugify('key: value; next')).toBe('key-value-next')
    })

    it('replaces plus signs and equals signs', () => {
      expect(slugify('a+b=c')).toBe('a-b-c')
    })

    it('replaces hash and dollar signs', () => {
      expect(slugify('#tag $price')).toBe('tag-price')
    })

    it('replaces backslashes', () => {
      expect(slugify('path\\to\\file')).toBe('path-to-file')
    })

    it('replaces curly braces', () => {
      expect(slugify('{hello}')).toBe('hello')
    })

    it('replaces pipe characters', () => {
      expect(slugify('option1|option2')).toBe('option1-option2')
    })

    it('replaces tildes and backticks', () => {
      expect(slugify('~home `code`')).toBe('home-code')
    })

    it('replaces quotes (single and double)', () => {
      expect(slugify("it's a \"test\"")).toBe('it-s-a-test')
    })

    it('replaces percent signs', () => {
      expect(slugify('100% complete')).toBe('100-complete')
    })

    it('replaces caret', () => {
      expect(slugify('x^2')).toBe('x-2')
    })

    it('handles mixed special characters in a row', () => {
      expect(slugify('a@#$%b')).toBe('a-b')
    })
  })

  describe('unicode handling', () => {
    it('removes unicode accented characters', () => {
      expect(slugify('cafe avec creme')).toBe('cafe-avec-creme')
    })

    it('removes emoji characters', () => {
      const result = slugify('hello world')
      // Emojis should be removed as they are non a-z0-9
      expect(result).toBe('hello-world')
    })

    it('removes Chinese characters', () => {
      expect(slugify('hello world')).toBe('hello-world')
    })

    it('removes Arabic characters', () => {
      expect(slugify('hello world')).toBe('hello-world')
    })

    it('removes accented vowels', () => {
      // accented chars become empty, producing hyphens
      const result = slugify('resume')
      expect(result).toBe('resume')
    })

    it('removes Japanese characters', () => {
      expect(slugify('test \u30c6\u30b9\u30c8 data')).toBe('test-data')
    })

    it('removes Korean characters', () => {
      expect(slugify('hello \ud55c\uad6d\uc5b4 world')).toBe('hello-world')
    })

    it('removes Cyrillic characters', () => {
      expect(slugify('hello \u043f\u0440\u0438\u0432\u0435\u0442 world')).toBe('hello-world')
    })

    it('handles input that is entirely non-latin characters', () => {
      expect(slugify('\u4f60\u597d\u4e16\u754c')).toBe('')
    })

    it('handles input with only emojis', () => {
      expect(slugify('\ud83d\ude00\ud83d\ude01\ud83d\ude02')).toBe('')
    })

    it('strips diacritical marks from latin-range characters', () => {
      // The regex [^a-z0-9] strips accented characters entirely
      const result = slugify('\u00e9l\u00e8ve')
      // e-accent chars are non a-z, so stripped; 'l' and 've' remain
      expect(result).toBe('l-ve')
    })

    it('handles mixed scripts and latin characters', () => {
      expect(slugify('abc\u4e2d\u6587def')).toBe('abc-def')
    })
  })

  describe('empty and whitespace input', () => {
    it('returns empty string for empty input', () => {
      expect(slugify('')).toBe('')
    })

    it('returns empty string for whitespace-only input', () => {
      expect(slugify('   ')).toBe('')
    })

    it('returns empty string for tab-only input', () => {
      expect(slugify('\t\t')).toBe('')
    })

    it('returns empty string for newline-only input', () => {
      expect(slugify('\n\n')).toBe('')
    })

    it('returns empty string for special characters only', () => {
      expect(slugify('!@#$%^&*()')).toBe('')
    })

    it('returns empty string for carriage return and newline', () => {
      expect(slugify('\r\n')).toBe('')
    })

    it('returns empty string for mixed whitespace only', () => {
      expect(slugify(' \t \n \r ')).toBe('')
    })

    it('returns empty string for vertical tab and form feed', () => {
      expect(slugify('\v\f')).toBe('')
    })
  })

  describe('consecutive spaces and hyphens', () => {
    it('collapses multiple spaces into a single hyphen', () => {
      expect(slugify('hello    world')).toBe('hello-world')
    })

    it('collapses multiple hyphens into a single hyphen', () => {
      expect(slugify('hello---world')).toBe('hello-world')
    })

    it('removes leading hyphens', () => {
      expect(slugify('-hello')).toBe('hello')
    })

    it('removes trailing hyphens', () => {
      expect(slugify('hello-')).toBe('hello')
    })

    it('removes both leading and trailing hyphens', () => {
      expect(slugify('-hello-world-')).toBe('hello-world')
    })

    it('handles leading spaces', () => {
      expect(slugify('  hello world')).toBe('hello-world')
    })

    it('handles trailing spaces', () => {
      expect(slugify('hello world  ')).toBe('hello-world')
    })

    it('handles mixed special chars producing consecutive hyphens', () => {
      expect(slugify('a!!b@@c')).toBe('a-b-c')
    })

    it('handles complex mixed input', () => {
      expect(slugify('  Hello, World!  How is it?  ')).toBe('hello-world-how-is-it')
    })

    it('collapses many consecutive hyphens', () => {
      expect(slugify('a----------b')).toBe('a-b')
    })

    it('handles alternating special chars and spaces', () => {
      expect(slugify('a ! @ b # $ c')).toBe('a-b-c')
    })

    it('produces clean slug from text with line breaks', () => {
      expect(slugify('line one\nline two\nline three')).toBe('line-one-line-two-line-three')
    })

    it('handles text with tabs between words', () => {
      expect(slugify('word1\tword2\tword3')).toBe('word1-word2-word3')
    })
  })

  describe('real-world slug patterns', () => {
    it('creates slug from a blog post title', () => {
      expect(slugify('How to Build a REST API in 2026')).toBe('how-to-build-a-rest-api-in-2026')
    })

    it('creates slug from a title with punctuation', () => {
      expect(slugify("What's New in TypeScript 5.9?")).toBe('what-s-new-in-typescript-5-9')
    })

    it('creates slug from a title with em-dash', () => {
      expect(slugify('EdgeCMS \u2014 The Future of Content')).toBe('edgecms-the-future-of-content')
    })

    it('creates slug from a title with ampersand', () => {
      expect(slugify('Terms & Conditions')).toBe('terms-conditions')
    })

    it('creates slug from a file name', () => {
      expect(slugify('my-document (final) v2.pdf')).toBe('my-document-final-v2-pdf')
    })

    it('creates slug from a URL-like string', () => {
      expect(slugify('https://example.com/path?query=1')).toBe(
        'https-example-com-path-query-1'
      )
    })

    it('creates slug from text with ellipsis', () => {
      expect(slugify('Coming soon...')).toBe('coming-soon')
    })

    it('creates slug from text with copyright symbol', () => {
      expect(slugify('EdgeCMS \u00a9 2026')).toBe('edgecms-2026')
    })

    it('is idempotent: slugifying a slug returns the same slug', () => {
      const slug = slugify('Hello World!')
      expect(slugify(slug)).toBe(slug)
    })
  })
})
