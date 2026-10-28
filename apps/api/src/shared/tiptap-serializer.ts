/**
 * TipTap / ProseMirror AST Machine Translation Delimiter-Shielding Serializer
 *
 * Converts TipTap rich text into a unified sentence-preserving text string with
 * protected unicode tokens: `⟦m:0⟧inner text⟦/m:0⟧`
 *
 * Allows LLMs and machine translation engines to translate the sentence as a unified
 * grammatical unit while preserving bold, italic, code, links, and mark structures.
 */

export interface TipTapNode {
  type: string
  text?: string
  content?: TipTapNode[]
  marks?: Array<{
    type: string
    attrs?: Record<string, unknown>
  }>
  attrs?: Record<string, unknown>
}

export interface ShieldedSerializationResult {
  text: string
  marksMap: Record<number, Array<{ type: string; attrs?: Record<string, unknown> }>>
}

/**
 * Serializes a TipTap block (e.g. paragraph or full document) into shielded text.
 */
export function serializeTipTapWithShielding(node: TipTapNode | null | undefined): ShieldedSerializationResult {
  const marksMap: Record<number, Array<{ type: string; attrs?: Record<string, unknown> }>> = {}
  let markCounter = 0

  function traverse(n: TipTapNode | undefined): string {
    if (!n) return ''

    if (n.type === 'text' && typeof n.text === 'string') {
      if (n.marks && n.marks.length > 0) {
        const id = markCounter++
        marksMap[id] = n.marks
        return `⟦m:${id}⟧${n.text}⟦/m:${id}⟧`
      }
      return n.text
    }

    if (Array.isArray(n.content)) {
      const childrenText = n.content.map(traverse).join('')
      if (n.type === 'paragraph' || n.type === 'heading') {
        return childrenText + '\n'
      }
      return childrenText
    }

    return ''
  }

  const rawText = traverse(node ?? undefined).trim()
  return {
    text: rawText,
    marksMap,
  }
}

/**
 * Reconstructs TipTap inline nodes from shielded translated text.
 */
export function reconstructTipTapNodesFromShielded(
  shieldedText: string,
  marksMap: Record<number, Array<{ type: string; attrs?: Record<string, unknown> }>>
): TipTapNode[] {
  const nodes: TipTapNode[] = []
  // Matches `⟦m:(\d+)⟧(.*?)⟦/m:\1⟧` or plain text segments
  const tokenRegex = /⟦m:(\d+)⟧([\s\S]*?)⟦\/m:\1⟧/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(shieldedText)) !== null) {
    const preText = shieldedText.slice(lastIndex, match.index)
    if (preText) {
      nodes.push({ type: 'text', text: preText })
    }

    const markId = Number.parseInt(match[1] as string, 10)
    const innerText = match[2] as string
    const marks = marksMap[markId]

    nodes.push({
      type: 'text',
      text: innerText,
      ...(marks ? { marks } : {}),
    })

    lastIndex = tokenRegex.lastIndex
  }

  const remainingText = shieldedText.slice(lastIndex)
  if (remainingText) {
    nodes.push({ type: 'text', text: remainingText })
  }

  return nodes
}
