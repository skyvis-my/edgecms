import { describe, expect, it } from 'bun:test'
import { slugify } from './slugify'

describe('slugify', () => {
  it('converts a simple string to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('trims leading and trailing whitespace before slugifying', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world')
  })

  it('replaces multiple consecutive spaces with a single dash', () => {
    expect(slugify('hello    world')).toBe('hello-world')
  })

  it('replaces underscores with dashes', () => {
    expect(slugify('hello_world')).toBe('hello-world')
  })

  it('collapses consecutive dashes into a single dash', () => {
    expect(slugify('hello---world')).toBe('hello-world')
  })

  it('collapses mixed separators (spaces, dashes, underscores) into a single dash', () => {
    expect(slugify('hello - _ world')).toBe('hello-world')
  })

  it('removes special characters', () => {
    expect(slugify('hello@world!')).toBe('helloworld')
  })

  it('removes punctuation marks', () => {
    expect(slugify("hello, world. it's great!")).toBe('hello-world-its-great')
  })

  it('handles strings with only special characters', () => {
    expect(slugify('!@#$%^&*()')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(slugify('   ')).toBe('')
  })

  it('strips unicode/international characters (non-word chars)', () => {
    // The regex [^\w\s-] removes non-ASCII word characters
    expect(slugify('cafe')).toBe('cafe')
  })

  it('removes leading and trailing dashes produced by stripped characters', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('handles a real-world title', () => {
    expect(slugify('My Blog Post: A Great Title! (2024)')).toBe('my-blog-post-a-great-title-2024')
  })

  it('preserves numbers in the slug', () => {
    expect(slugify('Article 123 Test')).toBe('article-123-test')
  })

  it('handles mixed case input', () => {
    expect(slugify('CamelCaseTitle')).toBe('camelcasetitle')
  })

  it('handles tabs and newlines as whitespace', () => {
    expect(slugify("hello\tworld\nnew")).toBe('hello-world-new')
  })
})
