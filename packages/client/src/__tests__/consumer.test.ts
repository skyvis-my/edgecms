import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { createEdgeCmsClient, renderContentToHtml } from '../../dist/index.js'
import { EdgeContent } from '../../dist/react.js'

describe('@edgecms/client Consumer Package Qualification', () => {
  it('instantiates createEdgeCmsClient from built package bundle', () => {
    const client = createEdgeCmsClient({
      baseUrl: 'https://cms.acme.com',
      tenantSlug: 'acme-corp',
    })

    expect(client).toBeDefined()
    expect(client.baseUrl).toBe('https://cms.acme.com')
    expect(client.tenantSlug).toBe('acme-corp')
    expect(typeof client.collection).toBe('function')
  })

  it('renders TipTap AST to HTML using built bundle serializer', () => {
    const ast = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Bundled Serializer' }],
        },
      ],
    }

    const html = renderContentToHtml(ast)
    expect(html).toBe('<h2>Bundled Serializer</h2>')
  })

  it('renders React component from built react.js bundle', () => {
    const ast = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Rendered from built react.js bundle' }],
        },
      ],
    }

    const html = renderToString(React.createElement(EdgeContent, { content: ast }))
    expect(html).toContain('<p>Rendered from built react.js bundle</p>')
  })
})
