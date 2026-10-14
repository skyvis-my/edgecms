import { describe, expect, it } from 'bun:test'
import { renderContentToHtml } from '../serializer'

describe('@edgecms/client TipTap ProseMirror Serializer', () => {
  it('renders paragraph with plain text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello, EdgeCMS!' }],
        },
      ],
    }

    const html = renderContentToHtml(doc)
    expect(html).toBe('<p>Hello, EdgeCMS!</p>')
  })

  it('renders headings with proper levels (1-6)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Subtitle' }] },
        { type: 'heading', attrs: { level: 9 }, content: [{ type: 'text', text: 'Clamped' }] },
      ],
    }

    const html = renderContentToHtml(doc)
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<h2>Subtitle</h2>')
    expect(html).toContain('<h6>Clamped</h6>')
  })

  it('renders blockquote, ordered and bullet lists', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Quote' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'text', text: 'Item A' }] },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 2 },
          content: [
            { type: 'listItem', content: [{ type: 'text', text: 'Item B' }] },
          ],
        },
      ],
    }

    const html = renderContentToHtml(doc)
    expect(html).toContain('<blockquote><p>Quote</p></blockquote>')
    expect(html).toContain('<ul><li>Item A</li></ul>')
    expect(html).toContain('<ol start="2"><li>Item B</li></ol>')
  })

  it('renders code blocks and images with attributes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'typescript' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
        {
          type: 'image',
          attrs: {
            src: 'https://images.unsplash.com/photo-1',
            alt: 'Hero image',
            title: 'Sample photo',
          },
        },
      ],
    }

    const html = renderContentToHtml(doc)
    expect(html).toContain('<pre><code class="language-typescript">const x = 1;</code></pre>')
    expect(html).toContain('<img src="https://images.unsplash.com/photo-1" alt="Hero image" title="Sample photo" />')
  })

  it('renders marks: bold, italic, code, strike, underline, link, highlight, sub, sup', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'Italic', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'Code', marks: [{ type: 'code' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'Strike', marks: [{ type: 'strike' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'Underline', marks: [{ type: 'underline' }] },
            {
              type: 'text',
              text: 'Link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }],
            },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'Mark', marks: [{ type: 'highlight', attrs: { color: '#ff0' } }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'Sub', marks: [{ type: 'subscript' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'Sup', marks: [{ type: 'superscript' }] },
          ],
        },
      ],
    }

    const html = renderContentToHtml(doc)
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<em>Italic</em>')
    expect(html).toContain('<code>Code</code>')
    expect(html).toContain('<s>Strike</s>')
    expect(html).toContain('<u>Underline</u>')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Link</a>')
    expect(html).toContain('<mark style="background-color: #ff0;">Mark</mark>')
    expect(html).toContain('<sub>Sub</sub>')
    expect(html).toContain('<sup>Sup</sup>')
  })

  it('escapes dangerous HTML in text and disallows javascript: URLs', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<script>alert(1)</script>' },
            {
              type: 'text',
              text: 'click me',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
        {
          type: 'image',
          attrs: { src: 'javascript:alert(2)' },
        },
      ],
    }

    const html = renderContentToHtml(doc)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="#"')
    expect(html).toContain('src="#"')
  })

  it('supports string inputs (JSON string and HTML string)', () => {
    const jsonStr = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From JSON string' }] }],
    })
    expect(renderContentToHtml(jsonStr)).toBe('<p>From JSON string</p>')

    const rawHtml = '<p>Already HTML</p>'
    expect(renderContentToHtml(rawHtml)).toBe('<p>Already HTML</p>')
    expect(renderContentToHtml(null)).toBe('')
  })

  it('supports custom renderers', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'callout', attrs: { type: 'warning' }, text: 'Careful!' },
      ],
    }

    const html = renderContentToHtml(doc, {
      customRenderers: {
        callout: (node) => `<div class="callout-${node.attrs?.type}">${node.text}</div>`,
      },
    })

    expect(html).toBe('<div class="callout-warning">Careful!</div>')
  })

  it('sanitizes malicious HTML and script tags in string inputs', () => {
    const maliciousHtml = '<p>Hello <script>alert("xss")</script><img src="x" onerror="alert(1)">World</p>'
    const sanitized = renderContentToHtml(maliciousHtml)
    expect(sanitized).not.toContain('<script>')
    expect(sanitized).not.toContain('onerror=')
    expect(sanitized).toContain('<p>Hello <img src="x">World</p>')

    const jsLinkHtml = '<a href="javascript:alert(1)">Click</a>'
    expect(renderContentToHtml(jsLinkHtml)).toContain('href="#"')
  })

  it('prevents CSS injection in highlight marks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Injected',
              marks: [{ type: 'highlight', attrs: { color: 'red; background-image: url("javascript:alert(1)")' } }],
            },
          ],
        },
      ],
    }

    const html = renderContentToHtml(doc)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('background-image')
    expect(html).toBe('<p><mark>Injected</mark></p>')
  })
})
