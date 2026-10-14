import * as React from 'react'
import type { TipTapMark, TipTapNode } from './types'
import { sanitizeHtmlString } from './serializer'

export type EdgeContentComponents = {
  paragraph?: React.ComponentType<{ children: React.ReactNode; node: TipTapNode }> | undefined
  heading?: React.ComponentType<{ level: number; children: React.ReactNode; node: TipTapNode }> | undefined
  blockquote?: React.ComponentType<{ children: React.ReactNode; node: TipTapNode }> | undefined
  bulletList?: React.ComponentType<{ children: React.ReactNode; node: TipTapNode }> | undefined
  orderedList?: React.ComponentType<{ start?: number | undefined; children: React.ReactNode; node: TipTapNode }> | undefined
  listItem?: React.ComponentType<{ children: React.ReactNode; node: TipTapNode }> | undefined
  codeBlock?: React.ComponentType<{ language?: string | undefined; code: string; node: TipTapNode }> | undefined
  image?: React.ComponentType<{ src: string; alt?: string | undefined; title?: string | undefined; node: TipTapNode }> | undefined
  link?: React.ComponentType<{ href: string; target?: string | undefined; rel?: string | undefined; children: React.ReactNode }> | undefined
}

export type EdgeContentProps = {
  content: unknown
  className?: string | undefined
  components?: EdgeContentComponents | undefined
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
    return trimmed
  }
  return '#'
}

function renderReactMarks(text: string, marks?: TipTapMark[], components?: EdgeContentComponents): React.ReactNode {
  if (!marks || marks.length === 0) return text

  let element: React.ReactNode = text

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]!
    const key = `mark-${mark.type}-${i}`

    switch (mark.type) {
      case 'bold':
      case 'strong':
        element = <strong key={key}>{element}</strong>
        break
      case 'italic':
      case 'em':
        element = <em key={key}>{element}</em>
        break
      case 'strike':
      case 's':
        element = <s key={key}>{element}</s>
        break
      case 'code':
        element = <code key={key}>{element}</code>
        break
      case 'underline':
      case 'u':
        element = <u key={key}>{element}</u>
        break
      case 'link': {
        const href = sanitizeUrl(mark.attrs?.href)
        const target = mark.attrs?.target ? String(mark.attrs.target) : undefined
        const rel = target === '_blank' ? 'noopener noreferrer' : undefined

        if (components?.link) {
          const LinkComp = components.link
          element = (
            <LinkComp key={key} href={href} target={target} rel={rel}>
              {element}
            </LinkComp>
          )
        } else {
          element = (
            <a key={key} href={href} target={target} rel={rel}>
              {element}
            </a>
          )
        }
        break
      }
      case 'highlight': {
        const rawColor = mark.attrs?.color ? String(mark.attrs.color) : ''
        const safeColor = /^[#a-zA-Z0-9(),. %-]+$/.test(rawColor) ? rawColor : undefined
        const style = safeColor ? { backgroundColor: safeColor } : undefined
        element = (
          <mark key={key} style={style}>
            {element}
          </mark>
        )
        break
      }
      case 'subscript':
      case 'sub':
        element = <sub key={key}>{element}</sub>
        break
      case 'superscript':
      case 'sup':
        element = <sup key={key}>{element}</sup>
        break
    }
  }

  return element
}

function renderReactNodes(nodes?: TipTapNode[], components?: EdgeContentComponents): React.ReactNode[] {
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) return []
  return nodes.map((node, index) => renderReactNode(node, `node-${index}`, components))
}

function renderReactNode(
  node: TipTapNode,
  key: string,
  components?: EdgeContentComponents
): React.ReactNode {
  if (!node || typeof node !== 'object') return null

  switch (node.type) {
    case 'doc':
      return <React.Fragment key={key}>{renderReactNodes(node.content, components)}</React.Fragment>

    case 'paragraph': {
      const children = renderReactNodes(node.content, components)
      if (components?.paragraph) {
        const Comp = components.paragraph
        return <Comp key={key} node={node}>{children}</Comp>
      }
      return <p key={key}>{children}</p>
    }

    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)
      const children = renderReactNodes(node.content, components)
      if (components?.heading) {
        const Comp = components.heading
        return <Comp key={key} level={level} node={node}>{children}</Comp>
      }
      const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return <HeadingTag key={key}>{children}</HeadingTag>
    }

    case 'blockquote': {
      const children = renderReactNodes(node.content, components)
      if (components?.blockquote) {
        const Comp = components.blockquote
        return <Comp key={key} node={node}>{children}</Comp>
      }
      return <blockquote key={key}>{children}</blockquote>
    }

    case 'bulletList': {
      const children = renderReactNodes(node.content, components)
      if (components?.bulletList) {
        const Comp = components.bulletList
        return <Comp key={key} node={node}>{children}</Comp>
      }
      return <ul key={key}>{children}</ul>
    }

    case 'orderedList': {
      const start = node.attrs?.start ? Number(node.attrs.start) : undefined
      const children = renderReactNodes(node.content, components)
      if (components?.orderedList) {
        const Comp = components.orderedList
        return <Comp key={key} start={start} node={node}>{children}</Comp>
      }
      return <ol key={key} start={start}>{children}</ol>
    }

    case 'listItem': {
      const children = renderReactNodes(node.content, components)
      if (components?.listItem) {
        const Comp = components.listItem
        return <Comp key={key} node={node}>{children}</Comp>
      }
      return <li key={key}>{children}</li>
    }

    case 'codeBlock': {
      const lang = node.attrs?.language ? String(node.attrs.language) : undefined
      const codeText = node.content?.map((c) => c.text ?? '').join('') ?? (node.text || '')
      if (components?.codeBlock) {
        const Comp = components.codeBlock
        return <Comp key={key} language={lang} code={codeText} node={node} />
      }
      return (
        <pre key={key}>
          <code className={lang ? `language-${lang}` : undefined}>{codeText}</code>
        </pre>
      )
    }

    case 'image': {
      const src = sanitizeUrl(node.attrs?.src)
      const alt = node.attrs?.alt ? String(node.attrs.alt) : ''
      const title = node.attrs?.title ? String(node.attrs.title) : undefined
      if (components?.image) {
        const Comp = components.image
        return <Comp key={key} src={src} alt={alt} title={title} node={node} />
      }
      return <img key={key} src={src} alt={alt} title={title} />
    }

    case 'horizontalRule':
      return <hr key={key} />

    case 'hardBreak':
      return <br key={key} />

    case 'text':
      return <React.Fragment key={key}>{renderReactMarks(node.text || '', node.marks, components)}</React.Fragment>

    default:
      if (node.content && node.content.length > 0) {
        return <React.Fragment key={key}>{renderReactNodes(node.content, components)}</React.Fragment>
      }
      return node.text ? <React.Fragment key={key}>{node.text}</React.Fragment> : null
  }
}

/**
 * React Component for rendering EdgeCMS TipTap / ProseMirror AST documents.
 */
export function EdgeContent({ content, className, components }: EdgeContentProps): React.JSX.Element | null {
  if (!content) return null

  let parsedNode: TipTapNode | null = null

  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        parsedNode = JSON.parse(trimmed) as TipTapNode
      } catch {
        // Fall back to text
      }
    }
    if (!parsedNode) {
      const sanitized = sanitizeHtmlString(trimmed)
      return <div className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />
    }
  } else if (typeof content === 'object') {
    parsedNode = content as TipTapNode
  }

  if (!parsedNode) return null

  return (
    <div className={className} data-edgecms-content='true'>
      {renderReactNode(parsedNode, 'root', components)}
    </div>
  )
}
