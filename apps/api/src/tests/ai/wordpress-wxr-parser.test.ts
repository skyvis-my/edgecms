import { describe, expect, it } from 'bun:test'
import {
  decodeXmlEntities,
  parseInlineContent,
  gutenbergToTipTap,
  parseWordPressWxr,
  stageWordPressImportCommands,
} from '@/ai/wordpress-wxr-parser'

describe('WordPress WXR XML & Gutenberg-to-TipTap Block Migration (C-13)', () => {
  describe('decodeXmlEntities', () => {
    it('decodes standard HTML and numeric entities', () => {
      const input = 'Tom &amp; Jerry &lt;rocks&gt; &quot;always&#039; &copy;'
      const decoded = decodeXmlEntities(input)
      expect(decoded).toContain('Tom & Jerry <rocks> "always\'')
    })
  })

  describe('parseInlineContent', () => {
    it('parses plain text without marks', () => {
      const nodes = parseInlineContent('Simple plain text')
      expect(nodes).toEqual([{ type: 'text', text: 'Simple plain text' }])
    })

    it('parses bold, italic, code, and links with TipTap marks', () => {
      const html =
        'Hello <strong>bold world</strong> and <em>italic text</em> with <code>code snippet</code> and <a href="https://edgecms.dev">link</a>.'
      const nodes = parseInlineContent(html)

      expect(nodes.some((n) => n.text === 'bold world' && n.marks?.some((m) => m.type === 'bold'))).toBe(true)
      expect(nodes.some((n) => n.text === 'italic text' && n.marks?.some((m) => m.type === 'italic'))).toBe(true)
      expect(nodes.some((n) => n.text === 'code snippet' && n.marks?.some((m) => m.type === 'code'))).toBe(true)
      const linkNode = nodes.find((n) => n.text === 'link')
      expect(linkNode?.marks?.[0]?.type).toBe('link')
      expect(linkNode?.marks?.[0]?.attrs?.href).toBe('https://edgecms.dev')
    })
  })

  describe('gutenbergToTipTap', () => {
    it('handles empty input', () => {
      expect(gutenbergToTipTap('')).toEqual({ type: 'doc', content: [] })
    })

    it('converts Gutenberg paragraph and heading blocks', () => {
      const gutenberg = `
<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">Welcome to EdgeCMS</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>This is a fast edge-first headless CMS.</p>
<!-- /wp:paragraph -->
`
      const doc = gutenbergToTipTap(gutenberg)
      expect(doc.type).toBe('doc')
      expect(doc.content).toHaveLength(2)

      const heading = doc.content[0]
      expect(heading?.type).toBe('heading')
      expect(heading?.attrs?.level).toBe(2)
      expect(heading?.content?.[0]?.text).toBe('Welcome to EdgeCMS')

      const paragraph = doc.content[1]
      expect(paragraph?.type).toBe('paragraph')
      expect(paragraph?.content?.[0]?.text).toBe('This is a fast edge-first headless CMS.')
    })

    it('converts Gutenberg unordered and ordered lists', () => {
      const gutenbergList = `
<!-- wp:list {"ordered":false} -->
<ul class="wp-block-list">
  <li>D1 Database</li>
  <li>KV Cache</li>
  <li>R2 Storage</li>
</ul>
<!-- /wp:list -->
`
      const doc = gutenbergToTipTap(gutenbergList)
      expect(doc.content).toHaveLength(1)
      const list = doc.content[0]
      expect(list?.type).toBe('bulletList')
      expect(list?.content).toHaveLength(3)
      expect(list?.content?.[0]?.type).toBe('listItem')
      expect(list?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('D1 Database')
    })

    it('converts Gutenberg quotes, code blocks, and images', () => {
      const gutenberg = `
<!-- wp:quote -->
<blockquote class="wp-block-quote"><p>The edge is the future.</p></blockquote>
<!-- /wp:quote -->

<!-- wp:code {"language":"typescript"} -->
<pre class="wp-block-code"><code class="language-typescript">const answer = 42;</code></pre>
<!-- /wp:code -->

<!-- wp:image {"id":100,"sizeSlug":"full"} -->
<figure class="wp-block-image size-full"><img src="https://images.edgecms.dev/architecture.png" alt="Architecture diagram"/></figure>
<!-- /wp:image -->

<!-- wp:separator /-->
`
      const doc = gutenbergToTipTap(gutenberg)
      expect(doc.content).toHaveLength(4)

      // Blockquote
      expect(doc.content[0]?.type).toBe('blockquote')
      expect(doc.content[0]?.content?.[0]?.content?.[0]?.text).toBe('The edge is the future.')

      // Code Block
      expect(doc.content[1]?.type).toBe('codeBlock')
      expect(doc.content[1]?.attrs?.language).toBe('typescript')
      expect(doc.content[1]?.content?.[0]?.text).toBe('const answer = 42;')

      // Image
      expect(doc.content[2]?.type).toBe('image')
      expect(doc.content[2]?.attrs?.src).toBe('https://images.edgecms.dev/architecture.png')
      expect(doc.content[2]?.attrs?.alt).toBe('Architecture diagram')

      // Separator
      expect(doc.content[3]?.type).toBe('horizontalRule')
    })

    it('converts classic WordPress HTML without Gutenberg comments seamlessly', () => {
      const classicHtml = `
<h2>Classic Post Title</h2>
<p>First paragraph of classic WordPress content.</p>
<blockquote><p>Classic blockquote.</p></blockquote>
<pre><code>console.log('classic');</code></pre>
`
      const doc = gutenbergToTipTap(classicHtml)
      expect(doc.content.length).toBeGreaterThanOrEqual(4)
      expect(doc.content[0]?.type).toBe('heading')
      expect(doc.content[1]?.type).toBe('paragraph')
      expect(doc.content[2]?.type).toBe('blockquote')
      expect(doc.content[3]?.type).toBe('codeBlock')
    })

    it('converts nested Gutenberg container blocks without comment leakage', () => {
      const nested = `
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group">
<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">Inner Group Heading</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Inner paragraph text.</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
`
      const doc = gutenbergToTipTap(nested)
      expect(doc.content).toHaveLength(2)
      expect(doc.content[0]?.type).toBe('heading')
      expect(doc.content[0]?.attrs?.level).toBe(3)
      expect(doc.content[0]?.content?.[0]?.text).toBe('Inner Group Heading')
      expect(doc.content[1]?.type).toBe('paragraph')
      expect(doc.content[1]?.content?.[0]?.text).toBe('Inner paragraph text.')

      const allText = JSON.stringify(doc)
      expect(allText).not.toContain('<!-- wp:')
      expect(allText).not.toContain('<!-- /wp:')
    })

    it('converts multi-column Gutenberg layouts with nested inner blocks', () => {
      const columns = `
<!-- wp:columns -->
<div class="wp-block-columns">
<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:paragraph -->
<p>Column 1 content</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column">
<!-- wp:paragraph -->
<p>Column 2 content</p>
<!-- /wp:paragraph -->
</div>
<!-- /wp:column -->
</div>
<!-- /wp:columns -->
`
      const doc = gutenbergToTipTap(columns)
      expect(doc.content).toHaveLength(2)
      expect(doc.content[0]?.type).toBe('paragraph')
      expect(doc.content[0]?.content?.[0]?.text).toBe('Column 1 content')
      expect(doc.content[1]?.type).toBe('paragraph')
      expect(doc.content[1]?.content?.[0]?.text).toBe('Column 2 content')
    })
  })

  describe('parseWordPressWxr', () => {
    const sampleWxrXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
	xmlns:content="http://purl.org/rss/1.0/modules/content/"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:wp="http://wordpress.org/export/1.2/"
>
<channel>
	<title>Test Blog</title>
	<item>
		<title><![CDATA[Hello World from WordPress]]></title>
		<pubDate>Wed, 15 Jan 2026 10:00:00 +0000</pubDate>
		<dc:creator><![CDATA[johndoe]]></dc:creator>
		<category domain="category" nicename="tech"><![CDATA[Technology]]></category>
		<category domain="post_tag" nicename="cloudflare"><![CDATA[Cloudflare]]></category>
		<content:encoded><![CDATA[<!-- wp:paragraph -->
<p>Welcome to your migrated WordPress post.</p>
<!-- /wp:paragraph -->]]></content:encoded>
		<wp:post_id>101</wp:post_id>
		<wp:post_name><![CDATA[hello-world-from-wordpress]]></wp:post_name>
		<wp:status><![CDATA[publish]]></wp:status>
		<wp:post_type><![CDATA[post]]></wp:post_type>
	</item>
	<item>
		<title><![CDATA[Draft Future Roadmap]]></title>
		<dc:creator><![CDATA[admin]]></dc:creator>
		<content:encoded><![CDATA[<p>Draft ideas not yet published.</p>]]></content:encoded>
		<wp:post_id>102</wp:post_id>
		<wp:post_name><![CDATA[draft-future-roadmap]]></wp:post_name>
		<wp:status><![CDATA[draft]]></wp:status>
		<wp:post_type><![CDATA[post]]></wp:post_type>
	</item>
	<item>
		<title><![CDATA[About Us]]></title>
		<content:encoded><![CDATA[<p>Page content.</p>]]></content:encoded>
		<wp:post_id>103</wp:post_id>
		<wp:post_name><![CDATA[about-us]]></wp:post_name>
		<wp:status><![CDATA[publish]]></wp:status>
		<wp:post_type><![CDATA[page]]></wp:post_type>
	</item>
</channel>
</rss>`

    it('parses posts, metadata, CDATA, categories, and tags', () => {
      const items = parseWordPressWxr(sampleWxrXml)
      expect(items).toHaveLength(3)

      const first = items[0]
      expect(first?.title).toBe('Hello World from WordPress')
      expect(first?.slug).toBe('hello-world-from-wordpress')
      expect(first?.status).toBe('publish')
      expect(first?.postType).toBe('post')
      expect(first?.creator).toBe('johndoe')
      expect(first?.categories).toContain('Technology')
      expect(first?.tags).toContain('Cloudflare')
      expect(first?.tipTapDoc.content[0]?.type).toBe('paragraph')
      expect(first?.tipTapDoc.content[0]?.content?.[0]?.text).toBe('Welcome to your migrated WordPress post.')
    })

    it('stages createEntry command envelopes with TipTap payloads', () => {
      const result = stageWordPressImportCommands(sampleWxrXml, 'articles-col-id', {
        postType: 'post',
      })

      expect(result.summary.totalItems).toBe(3)
      expect(result.summary.stagedCount).toBe(2) // 2 'post' items staged, 1 'page' item skipped
      expect(result.summary.skippedCount).toBe(1)
      expect(result.summary.postTypes).toEqual({ post: 2, page: 1 })

      expect(result.commands).toHaveLength(2)

      const cmd1 = result.commands[0]
      expect(cmd1?.type).toBe('createEntry')
      expect(cmd1?.actor.source).toBe('ai')
      expect(cmd1?.dryRun).toBe(true)
      expect(cmd1?.payload.collectionId).toBe('articles-col-id')
      expect(cmd1?.payload.slug).toBe('hello-world-from-wordpress')
      const data1 = cmd1?.payload.data as { title?: string; content?: { type?: string } } | undefined
      expect(data1?.title).toBe('Hello World from WordPress')
      expect(data1?.content?.type).toBe('doc')

      const cmd2 = result.commands[1]
      expect(cmd2?.payload.status).toBe('draft')
    })
  })
})
