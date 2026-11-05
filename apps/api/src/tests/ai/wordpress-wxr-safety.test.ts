/**
 * AI-08: the WordPress WXR parser treats the export as untrusted input.
 */
import { describe, expect, it } from 'bun:test'
import {
  MAX_WXR_BYTES,
  MAX_WXR_ITEMS,
  gutenbergToTipTap,
  parseInlineContent,
  parseWordPressWxr,
  stageWordPressImportCommands,
  type TipTapNode,
} from '@/ai/wordpress-wxr-parser'

function wxr(items: string, prolog = ''): string {
  return `<?xml version="1.0"?>${prolog}<rss><channel>${items}</channel></rss>`
}

function item(body: string, status = 'publish'): string {
  return `<item><title>Post</title><content:encoded><![CDATA[${body}]]></content:encoded><wp:post_name>post</wp:post_name><wp:status>${status}</wp:status><wp:post_type>post</wp:post_type></item>`
}

function allNodes(nodes: TipTapNode[] = []): TipTapNode[] {
  return nodes.flatMap((node) => [node, ...allNodes(node.content)])
}

describe('WXR parser safety', () => {
  it('does not expand DTD entities (billion laughs)', () => {
    const dtd =
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">' +
      '<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>'
    const xml = wxr('<item><title>&lol3;</title><wp:post_type>post</wp:post_type></item>', dtd)
    const [parsed] = parseWordPressWxr(xml)
    expect(parsed?.title).toBe('&lol3;')
  })

  it('drops javascript: and data: link targets', () => {
    for (const href of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'java&#x09;script:alert(1)']) {
      const nodes = parseInlineContent(`<a href="${href}">click</a>`)
      expect(nodes[0]?.text).toBe('click')
      expect(nodes[0]?.marks ?? []).toEqual([])
    }
  })

  it('keeps http, https, mailto and relative links', () => {
    for (const href of ['https://example.com/a', 'http://example.com', 'mailto:a@example.com', '/about', '#top']) {
      const nodes = parseInlineContent(`<a href="${href}">x</a>`)
      expect(nodes[0]?.marks?.[0]?.attrs?.href).toBe(href)
    }
  })

  it('drops image nodes with script or data sources', () => {
    const doc = gutenbergToTipTap(
      '<img src="javascript:alert(1)" alt="a"><img src="data:image/svg+xml,<svg onload=alert(1)>" alt="b"><img src="https://cdn.example.com/a.png" alt="c">'
    )
    const images = allNodes(doc.content).filter((node) => node.type === 'image')
    expect(images.map((node) => node.attrs?.src)).toEqual(['https://cdn.example.com/a.png'])
  })

  it('drops unsafe sources in Gutenberg image blocks, including attrs.url', () => {
    const doc = gutenbergToTipTap(
      '<!-- wp:image {"url":"javascript:alert(1)"} --><figure></figure><!-- /wp:image -->'
    )
    expect(allNodes(doc.content).filter((node) => node.type === 'image')).toHaveLength(0)
  })

  it('rejects an export larger than the size limit', () => {
    const big = wxr(item('x'.repeat(MAX_WXR_BYTES)))
    expect(() => parseWordPressWxr(big)).toThrow(/too large/i)
  })

  it('rejects an export with more items than the limit', () => {
    const many = wxr(item('<p>a</p>').repeat(MAX_WXR_ITEMS + 1))
    expect(() => parseWordPressWxr(many)).toThrow(/too many items/i)
  })

  it('stages published WordPress posts as drafts unless publishing is asked for', () => {
    const xml = wxr(item('<p>Hello</p>', 'publish'))
    expect(stageWordPressImportCommands(xml, 'col').commands[0]?.payload.status).toBe('draft')
    expect(
      stageWordPressImportCommands(xml, 'col', { defaultStatus: 'published' }).commands[0]?.payload.status
    ).toBe('published')
  })
})
