import type { CommandEnvelope } from '@edgecms/schemas/commands'

export type TipTapMark = {
  type: string
  attrs?: Record<string, unknown>
}

export type TipTapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  text?: string
  marks?: TipTapMark[]
}

export type TipTapDoc = {
  type: 'doc'
  content: TipTapNode[]
}

export type WordPressPostItem = {
  postId?: string
  title: string
  slug: string
  status: string
  postType: string
  pubDate?: string
  creator?: string
  categories: string[]
  tags: string[]
  rawContent: string
  tipTapDoc: TipTapDoc
}

export type StageWordPressOptions = {
  postType?: string
  defaultStatus?: 'draft' | 'published'
  locale?: string
  actorUserId?: string
}

export type StageWordPressResult = {
  commands: CommandEnvelope[]
  summary: {
    totalItems: number
    stagedCount: number
    skippedCount: number
    postTypes: Record<string, number>
  }
}

/**
 * Decodes standard HTML and XML entities.
 */
export function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

function cleanSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return slug || `wp-post-${Date.now()}`
}

/**
 * Parses inline HTML string into TipTap text nodes with marks (bold, italic, code, link).
 */
export function parseInlineContent(html: string): TipTapNode[] {
  if (!html) return []

  // Strip XML/HTML comments so Gutenberg markers never leak into user-visible text
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, '')
  if (!cleanHtml) return []

  const nodes: TipTapNode[] = []
  // Tokenize tags and text
  const tagRegex = /(<\/?([a-zA-Z0-9]+)(?:\s+[^>]*)?>)/g
  let lastIndex = 0
  const activeMarks: TipTapMark[] = []

  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(cleanHtml)) !== null) {
    const textBefore = cleanHtml.slice(lastIndex, match.index)
    if (textBefore) {
      const decoded = decodeXmlEntities(textBefore)
      if (decoded) {
        nodes.push({
          type: 'text',
          text: decoded,
          ...(activeMarks.length > 0 ? { marks: [...activeMarks] } : {}),
        })
      }
    }

    const fullTag = match[1] ?? ''
    const tagName = (match[2] ?? '').toLowerCase()
    const isClosing = fullTag.startsWith('</')

    if (isClosing) {
      // Pop matching mark
      const markType =
        tagName === 'strong' || tagName === 'b'
          ? 'bold'
          : tagName === 'em' || tagName === 'i'
            ? 'italic'
            : tagName === 'code'
              ? 'code'
              : tagName === 'a'
                ? 'link'
                : null

      if (markType) {
        const idx = activeMarks.findIndex((m) => m.type === markType)
        if (idx !== -1) activeMarks.splice(idx, 1)
      }
    } else {
      // Opening tag
      if (tagName === 'strong' || tagName === 'b') {
        if (!activeMarks.some((m) => m.type === 'bold')) {
          activeMarks.push({ type: 'bold' })
        }
      } else if (tagName === 'em' || tagName === 'i') {
        if (!activeMarks.some((m) => m.type === 'italic')) {
          activeMarks.push({ type: 'italic' })
        }
      } else if (tagName === 'code') {
        if (!activeMarks.some((m) => m.type === 'code')) {
          activeMarks.push({ type: 'code' })
        }
      } else if (tagName === 'a') {
        const hrefMatch = /href=["']([^"']*)["']/i.exec(fullTag)
        if (hrefMatch?.[1]) {
          activeMarks.push({
            type: 'link',
            attrs: { href: decodeXmlEntities(hrefMatch[1]) },
          })
        }
      }
    }

    lastIndex = tagRegex.lastIndex
  }

  const trailingText = cleanHtml.slice(lastIndex)
  if (trailingText) {
    const decoded = decodeXmlEntities(trailingText)
    if (decoded) {
      nodes.push({
        type: 'text',
        text: decoded,
        ...(activeMarks.length > 0 ? { marks: [...activeMarks] } : {}),
      })
    }
  }

  return nodes
}

/**
 * Parses a single Gutenberg block by block name, attributes JSON, and raw inner HTML.
 */
function parseGutenbergBlock(
  blockName: string,
  attrsJson: string | undefined,
  innerHtml: string
): TipTapNode | TipTapNode[] | null {
  let attrs: Record<string, unknown> = {}
  if (attrsJson) {
    try {
      attrs = JSON.parse(attrsJson)
    } catch {
      attrs = {}
    }
  }

  const trimmedHtml = innerHtml.trim()

  switch (blockName) {
    case 'core/group':
    case 'group':
    case 'core/columns':
    case 'columns':
    case 'core/column':
    case 'column':
    case 'core/cover':
    case 'cover': {
      if (/<!--\s*wp:/i.test(trimmedHtml)) {
        return gutenbergToTipTap(trimmedHtml).content
      }
      const classic = parseClassicHtml(trimmedHtml)
      if (classic.length > 0) return classic
      const stripped = trimmedHtml.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').trim()
      if (!stripped) return null
      const content = parseInlineContent(trimmedHtml)
      return content.length > 0 ? { type: 'paragraph', content } : null
    }

    case 'core/paragraph':
    case 'paragraph': {
      const pMatch = /<p(?:\s+[^>]*)?>([\s\S]*?)<\/p>/i.exec(trimmedHtml)
      const content = parseInlineContent(pMatch ? (pMatch[1] ?? '') : trimmedHtml)
      return {
        type: 'paragraph',
        ...(content.length > 0 ? { content } : {}),
      }
    }

    case 'core/heading':
    case 'heading': {
      let level = Number(attrs.level) || 2
      const hMatch = /<h([1-6])(?:\s+[^>]*)?>([\s\S]*?)<\/h\1>/i.exec(trimmedHtml)
      if (hMatch?.[1]) {
        level = Number(hMatch[1]) || level
      }
      const rawText = hMatch ? (hMatch[2] ?? '') : trimmedHtml
      const content = parseInlineContent(rawText)
      return {
        type: 'heading',
        attrs: { level },
        ...(content.length > 0 ? { content } : {}),
      }
    }

    case 'core/list':
    case 'list': {
      const ordered = Boolean(attrs.ordered) || /<ol(?:\s+[^>]*)?>/i.test(trimmedHtml)
      const listItems: TipTapNode[] = []
      const liRegex = /<li(?:\s+[^>]*)?>([\s\S]*?)<\/li>/gi
      let liMatch: RegExpExecArray | null
      while ((liMatch = liRegex.exec(trimmedHtml)) !== null) {
        const itemContent = parseInlineContent(liMatch[1] ?? '')
        listItems.push({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              ...(itemContent.length > 0 ? { content: itemContent } : {}),
            },
          ],
        })
      }
      if (listItems.length === 0) return null
      return {
        type: ordered ? 'orderedList' : 'bulletList',
        content: listItems,
      }
    }

    case 'core/quote':
    case 'quote': {
      const pRegex = /<p(?:\s+[^>]*)?>([\s\S]*?)<\/p>/gi
      const quoteParagraphs: TipTapNode[] = []
      let pMatch: RegExpExecArray | null
      while ((pMatch = pRegex.exec(trimmedHtml)) !== null) {
        const content = parseInlineContent(pMatch[1] ?? '')
        quoteParagraphs.push({
          type: 'paragraph',
          ...(content.length > 0 ? { content } : {}),
        })
      }
      if (quoteParagraphs.length === 0) {
        const content = parseInlineContent(trimmedHtml.replace(/<[^>]+>/g, ' ').trim())
        quoteParagraphs.push({
          type: 'paragraph',
          ...(content.length > 0 ? { content } : {}),
        })
      }
      return {
        type: 'blockquote',
        content: quoteParagraphs,
      }
    }

    case 'core/code':
    case 'code': {
      const codeMatch = /<code(?:\s+[^>]*)?>([\s\S]*?)<\/code>/i.exec(trimmedHtml)
      const rawCode = codeMatch ? (codeMatch[1] ?? '') : trimmedHtml.replace(/<\/?pre[^>]*>/gi, '')
      const codeText = decodeXmlEntities(rawCode.trim())
      return {
        type: 'codeBlock',
        ...(attrs.language ? { attrs: { language: String(attrs.language) } } : {}),
        content: [{ type: 'text', text: codeText }],
      }
    }

    case 'core/image':
    case 'image': {
      const imgMatch = /<img(?:\s+[^>]*)src=["']([^"']*)["'](?:\s+[^>]*)alt=["']([^"']*)["']?/i.exec(
        trimmedHtml
      ) || /<img(?:\s+[^>]*)src=["']([^"']*)["']/i.exec(trimmedHtml)
      const src = imgMatch?.[1] ? decodeXmlEntities(imgMatch[1]) : String(attrs.url || '')
      const alt = imgMatch?.[2] ? decodeXmlEntities(imgMatch[2]) : String(attrs.alt || '')
      if (!src) return null
      return {
        type: 'image',
        attrs: {
          src,
          alt,
          ...(attrs.title ? { title: String(attrs.title) } : {}),
        },
      }
    }

    case 'core/separator':
    case 'separator': {
      return { type: 'horizontalRule' }
    }

    default: {
      if (/<!--\s*wp:/i.test(trimmedHtml)) {
        return gutenbergToTipTap(trimmedHtml).content
      }
      const classic = parseClassicHtml(trimmedHtml)
      if (classic.length > 0) return classic
      const stripped = trimmedHtml.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').trim()
      if (!stripped) return null
      const content = parseInlineContent(trimmedHtml)
      return {
        type: 'paragraph',
        ...(content.length > 0 ? { content } : {}),
      }
    }
  }
}

/**
 * Parses raw HTML into TipTap nodes when content does not use Gutenberg block comments.
 */
function parseClassicHtml(html: string): TipTapNode[] {
  const nodes: TipTapNode[] = []
  const blockRegex =
    /<(p|h[1-6]|blockquote|pre|ul|ol|hr|figure|img)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>|<(hr|img)(?:\s+[^>]*)?\/?>/gi

  let match: RegExpExecArray | null

  while ((match = blockRegex.exec(html)) !== null) {
    const rawTag = (match[1] || match[3] || '').toLowerCase()
    const inner = match[2] ?? ''

    if (rawTag === 'p') {
      const content = parseInlineContent(inner)
      if (content.length > 0) nodes.push({ type: 'paragraph', content })
    } else if (/^h[1-6]$/.test(rawTag)) {
      const level = parseInt(rawTag[1] ?? '2', 10)
      const content = parseInlineContent(inner)
      if (content.length > 0) nodes.push({ type: 'heading', attrs: { level }, content })
    } else if (rawTag === 'blockquote') {
      const content = parseInlineContent(inner.replace(/<[^>]+>/g, ' ').trim())
      nodes.push({ type: 'blockquote', content: [{ type: 'paragraph', content }] })
    } else if (rawTag === 'pre') {
      const codeMatch = /<code(?:\s+[^>]*)?>([\s\S]*?)<\/code>/i.exec(inner)
      const codeText = decodeXmlEntities((codeMatch ? codeMatch[1] : inner) ?? '').trim()
      nodes.push({ type: 'codeBlock', content: [{ type: 'text', text: codeText }] })
    } else if (rawTag === 'ul' || rawTag === 'ol') {
      const ordered = rawTag === 'ol'
      const listItems: TipTapNode[] = []
      const liRegex = /<li(?:\s+[^>]*)?>([\s\S]*?)<\/li>/gi
      let liMatch: RegExpExecArray | null
      while ((liMatch = liRegex.exec(inner)) !== null) {
        const itemContent = parseInlineContent(liMatch[1] ?? '')
        listItems.push({
          type: 'listItem',
          content: [{ type: 'paragraph', ...(itemContent.length > 0 ? { content: itemContent } : {}) }],
        })
      }
      if (listItems.length > 0) {
        nodes.push({ type: ordered ? 'orderedList' : 'bulletList', content: listItems })
      }
    } else if (rawTag === 'hr') {
      nodes.push({ type: 'horizontalRule' })
    } else if (rawTag === 'img') {
      const full = match[0]
      const srcMatch = /src=["']([^"']*)["']/i.exec(full)
      const altMatch = /alt=["']([^"']*)["']/i.exec(full)
      if (srcMatch?.[1]) {
        nodes.push({
          type: 'image',
          attrs: {
            src: decodeXmlEntities(srcMatch[1]),
            alt: altMatch?.[1] ? decodeXmlEntities(altMatch[1]) : '',
          },
        })
      }
    }
  }

  // If no HTML blocks found, split raw text by double newlines
  if (nodes.length === 0) {
    const paragraphs = html.split(/\n\s*\n/)
    for (const p of paragraphs) {
      const trimmed = p.trim()
      if (trimmed) {
        const content = parseInlineContent(trimmed)
        if (content.length > 0) nodes.push({ type: 'paragraph', content })
      }
    }
  }

  return nodes
}

/**
 * Converts WordPress content (Gutenberg blocks or classic HTML) into a TipTap ProseMirror JSON AST.
 */
export function gutenbergToTipTap(contentHtml: string): TipTapDoc {
  if (!contentHtml || !contentHtml.trim()) {
    return { type: 'doc', content: [] }
  }

  const raw = contentHtml.trim()
  const hasGutenbergComments = /<!--\s*wp:/i.test(raw)

  if (!hasGutenbergComments) {
    const content = parseClassicHtml(raw)
    return { type: 'doc', content }
  }

  const nodes: TipTapNode[] = []
  // Matches block start: <!-- wp:name {json}? --> or self-closing <!-- wp:name {json}? /-->
  const blockRegex =
    /<!--\s*wp:([\w/-]+)(?:\s+({[\s\S]*?}))?\s*(\/-->|-->)([\s\S]*?)(?:<!--\s*\/wp:\1\s*-->|$)/gi

  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(raw)) !== null) {
    const blockName = match[1] ?? ''
    const attrsJson = match[2]
    const isSelfClosing = match[3] === '/-->'
    const innerContent = isSelfClosing ? '' : (match[4] ?? '')

    const node = parseGutenbergBlock(blockName, attrsJson, innerContent)
    if (node) {
      if (Array.isArray(node)) {
        nodes.push(...node)
      } else {
        nodes.push(node)
      }
    }
  }

  return { type: 'doc', content: nodes }
}

/**
 * Extracts inner content of an XML tag, handling CDATA blocks.
 */
function extractXmlTagContent(xml: string, tagName: string): string {
  const regex = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9]+:)?${tagName}>`, 'i')
  const match = regex.exec(xml)
  if (!match?.[1]) return ''

  let content = match[1].trim()
  const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(content)
  if (cdataMatch?.[1]) {
    return cdataMatch[1].trim()
  }
  return decodeXmlEntities(content)
}

/**
 * Extracts all matching category/tag terms from an item XML chunk.
 */
function extractCategoriesAndTags(itemXml: string): { categories: string[]; tags: string[] } {
  const categories: string[] = []
  const tags: string[] = []

  const catRegex = /<category(?:\s+[^>]*)domain=["']([^"']*)["'](?:\s+[^>]*)?>([\s\S]*?)<\/category>/gi
  let match: RegExpExecArray | null

  while ((match = catRegex.exec(itemXml)) !== null) {
    const domain = (match[1] ?? '').toLowerCase()
    let val = (match[2] ?? '').trim()
    const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(val)
    if (cdataMatch?.[1]) val = cdataMatch[1].trim()
    val = decodeXmlEntities(val)

    if (val) {
      if (domain === 'category') {
        categories.push(val)
      } else if (domain === 'post_tag' || domain === 'tag') {
        tags.push(val)
      }
    }
  }

  return { categories, tags }
}

/**
 * Parses WordPress WXR XML export into structured post items with TipTap AST docs.
 */
export function parseWordPressWxr(wxrXml: string): WordPressPostItem[] {
  if (!wxrXml || !wxrXml.trim()) return []

  const items: WordPressPostItem[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi

  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(wxrXml)) !== null) {
    const itemXml = match[1] ?? ''

    const title = extractXmlTagContent(itemXml, 'title')
    const rawSlug = extractXmlTagContent(itemXml, 'post_name')
    const status = extractXmlTagContent(itemXml, 'status') || 'publish'
    const postType = extractXmlTagContent(itemXml, 'post_type') || 'post'
    const postId = extractXmlTagContent(itemXml, 'post_id')
    const pubDate = extractXmlTagContent(itemXml, 'pubDate') || extractXmlTagContent(itemXml, 'post_date')
    const creator = extractXmlTagContent(itemXml, 'creator')
    const rawContent = extractXmlTagContent(itemXml, 'encoded')

    const { categories, tags } = extractCategoriesAndTags(itemXml)
    const tipTapDoc = gutenbergToTipTap(rawContent)

    items.push({
      postId: postId || undefined,
      title: title || 'Untitled Post',
      slug: cleanSlug(rawSlug || title),
      status,
      postType,
      pubDate: pubDate || undefined,
      creator: creator || undefined,
      categories,
      tags,
      rawContent,
      tipTapDoc,
    })
  }

  return items
}

/**
 * Converts a WordPress WXR XML export into staged EdgeCMS createEntry CommandEnvelopes.
 */
export function stageWordPressImportCommands(
  wxrXml: string,
  collectionId: string,
  options: StageWordPressOptions = {}
): StageWordPressResult {
  const items = parseWordPressWxr(wxrXml)
  const targetPostType = options.postType ?? 'post'

  const postTypes: Record<string, number> = {}
  for (const item of items) {
    postTypes[item.postType] = (postTypes[item.postType] ?? 0) + 1
  }

  const commands: CommandEnvelope[] = []
  let skippedCount = 0

  for (const item of items) {
    if (item.postType !== targetPostType) {
      skippedCount++
      continue
    }

    const entryStatus: 'draft' | 'published' =
      options.defaultStatus ?? (item.status === 'publish' ? 'published' : 'draft')

    const envelope: CommandEnvelope = {
      type: 'createEntry',
      payload: {
        collectionId,
        slug: item.slug,
        status: entryStatus,
        data: {
          title: item.title,
          slug: item.slug,
          content: item.tipTapDoc,
          categories: item.categories,
          tags: item.tags,
          ...(item.creator ? { author: item.creator } : {}),
          ...(item.pubDate ? { publishedAt: item.pubDate } : {}),
        },
      },
      actor: {
        userId: options.actorUserId ?? 'system',
        source: 'ai',
      },
      dryRun: true,
      timestamp: new Date().toISOString(),
    }

    commands.push(envelope)
  }

  return {
    commands,
    summary: {
      totalItems: items.length,
      stagedCount: commands.length,
      skippedCount,
      postTypes,
    },
  }
}
