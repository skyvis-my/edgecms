import type { RenderHtmlOptions, TipTapMark, TipTapNode } from './types'

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const HTML_ESCAPE_REGEX = /[&<>"']/g

function escapeHtml(text: string): string {
  return text.replace(HTML_ESCAPE_REGEX, (char) => HTML_ESCAPE_MAP[char] || char)
}

function sanitizeUrl(url?: unknown): string {
  if (typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return escapeHtml(trimmed)
  }
  return '#'
}

function renderMarks(text: string, marks?: TipTapMark[]): string {
  if (!marks || marks.length === 0) return escapeHtml(text)

  let rendered = escapeHtml(text)

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        rendered = `<strong>${rendered}</strong>`
        break
      case 'italic':
      case 'em':
        rendered = `<em>${rendered}</em>`
        break
      case 'strike':
      case 's':
        rendered = `<s>${rendered}</s>`
        break
      case 'code':
        rendered = `<code>${rendered}</code>`
        break
      case 'underline':
      case 'u':
        rendered = `<u>${rendered}</u>`
        break
      case 'link': {
        const href = sanitizeUrl(mark.attrs?.href)
        const target = mark.attrs?.target ? ` target="${escapeHtml(String(mark.attrs.target))}"` : ''
        const rel = mark.attrs?.target === '_blank' ? ' rel="noopener noreferrer"' : ''
        rendered = `<a href="${href}"${target}${rel}>${rendered}</a>`
        break
      }
      case 'highlight': {
        const rawColor = mark.attrs?.color ? String(mark.attrs.color) : ''
        const safeColor = /^[#a-zA-Z0-9(),. %-]+$/.test(rawColor) ? rawColor : ''
        const color = safeColor ? ` style="background-color: ${escapeHtml(safeColor)};"` : ''
        rendered = `<mark${color}>${rendered}</mark>`
        break
      }
      case 'subscript':
      case 'sub':
        rendered = `<sub>${rendered}</sub>`
        break
      case 'superscript':
      case 'sup':
        rendered = `<sup>${rendered}</sup>`
        break
    }
  }

  return rendered
}

function renderChildren(nodes?: TipTapNode[], options?: RenderHtmlOptions): string {
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return ''
  return nodes.map((child) => renderNode(child, options)).join('')
}

function renderNode(node: TipTapNode, options?: RenderHtmlOptions): string {
  if (!node || typeof node !== 'object') return ''

  if (options?.customRenderers?.[node.type || '']) {
    return options.customRenderers[node.type || '']!(node)
  }

  switch (node.type) {
    case 'doc':
      return renderChildren(node.content, options)

    case 'paragraph': {
      const inner = renderChildren(node.content, options)
      return inner ? `<p>${inner}</p>` : '<p></p>'
    }

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)
      const inner = renderChildren(node.content, options)
      return `<h${level}>${inner}</h${level}>`
    }

    case 'blockquote': {
      const inner = renderChildren(node.content, options)
      return `<blockquote>${inner}</blockquote>`
    }

    case 'bulletList': {
      const inner = renderChildren(node.content, options)
      return `<ul>${inner}</ul>`
    }

    case 'orderedList': {
      const start = node.attrs?.start ? ` start="${Number(node.attrs.start)}"` : ''
      const inner = renderChildren(node.content, options)
      return `<ol${start}>${inner}</ol>`
    }

    case 'listItem': {
      const inner = renderChildren(node.content, options)
      return `<li>${inner}</li>`
    }

    case 'codeBlock': {
      const lang = node.attrs?.language ? ` class="language-${escapeHtml(String(node.attrs.language))}"` : ''
      const codeText = node.content?.map((c) => c.text ?? '').join('') ?? (node.text || '')
      return `<pre><code${lang}>${escapeHtml(codeText)}</code></pre>`
    }

    case 'image': {
      const src = sanitizeUrl(node.attrs?.src)
      const alt = node.attrs?.alt ? ` alt="${escapeHtml(String(node.attrs.alt))}"` : ' alt=""'
      const title = node.attrs?.title ? ` title="${escapeHtml(String(node.attrs.title))}"` : ''
      return `<img src="${src}"${alt}${title} />`
    }

    case 'horizontalRule':
      return '<hr />'

    case 'hardBreak':
      return '<br />'

    case 'text':
      return renderMarks(node.text || '', node.marks)

    default:
      if (node.content && node.content.length > 0) {
        return renderChildren(node.content, options)
      }
      return node.text ? escapeHtml(node.text) : ''
  }
}

/**
 * Sanitizes arbitrary raw HTML strings by stripping script/iframe tags, event handlers, and javascript: URLs.
 */
export function sanitizeHtmlString(rawHtml: string): string {
  if (!rawHtml) return ''
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<\/?(?:script|style|iframe|object|embed|svg|math)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(\b(?:href|src)\s*=\s*['"])\s*(?:javascript|vbscript|data):[^'"]*(['"])/gi, '$1#$2')
}

/**
 * Converts a TipTap / ProseMirror JSON AST (or string representation) into semantic, accessible HTML.
 */
export function renderContentToHtml(
  content: unknown,
  options?: RenderHtmlOptions
): string {
  if (!content) return ''

  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object') {
          return renderNode(parsed as TipTapNode, options)
        }
      } catch {
        // Fall back to plain string
      }
    }
    // Return sanitized HTML string
    return sanitizeHtmlString(trimmed)
  }

  if (typeof content === 'object') {
    return renderNode(content as TipTapNode, options)
  }

  return ''
}
