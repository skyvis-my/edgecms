import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { EdgeContent } from '../react'

describe('@edgecms/client React Component', () => {
  it('renders TipTap AST document using React server rendering', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Rendered with React' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://edgecms.dev' } }] },
          ],
        },
      ],
    }

    const html = renderToString(<EdgeContent content={content} className="prose" />)
    expect(html).toContain('class="prose"')
    expect(html).toContain('<h1>Rendered with React</h1>')
    expect(html).toContain('<p>This is <strong>bold</strong> and <a href="https://edgecms.dev">a link</a></p>')
  })

  it('supports custom React component overrides', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Custom Header' }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'js' },
          content: [{ type: 'text', text: 'console.log(42)' }],
        },
      ],
    }

    const CustomHeading = ({ level, children }: { level: number; children: React.ReactNode }) => (
      <div className={`custom-h${level}`}>{children}</div>
    )

    const CustomCodeBlock = ({ language, code }: { language?: string; code: string }) => (
      <div data-lang={language} className="custom-code">{code}</div>
    )

    const html = renderToString(
      <EdgeContent
        content={content}
        components={{
          heading: CustomHeading,
          codeBlock: CustomCodeBlock,
        }}
      />
    )

    expect(html).toContain('<div class="custom-h2">Custom Header</div>')
    expect(html).toContain('<div data-lang="js" class="custom-code">console.log(42)</div>')
  })

  it('renders raw HTML fallback', () => {
    const html = renderToString(<EdgeContent content="<p>Raw text</p>" />)
    expect(html).toContain('<p>Raw text</p>')

    const nullHtml = renderToString(<EdgeContent content={null} />)
    expect(nullHtml).toBe('')
  })

  it('sanitizes malicious script tags and inline event handlers in raw HTML string fallback', () => {
    const malicious = '<p>Safe paragraph</p><script>alert("xss")</script><img src="x" onerror="evil()">'
    const html = renderToString(<EdgeContent content={malicious} />)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('onerror=')
    expect(html).toContain('<p>Safe paragraph</p><img src="x">')
  })
})
