import type { Root, Text, PhrasingContent, Parent } from 'mdast'

/**
 * Remark plugin that transforms ==highlight== and ++underline++ syntax
 * into custom AST nodes rendered as <mark> and <u> elements.
 *
 * Implementation notes:
 * - Pure AST transformation: no raw HTML, no dangerouslySetInnerHTML.
 * - Skips code blocks and inline code so literal == / ++ are preserved.
 * - Uses `data.hName` which remark-rehype reads to pick the output element.
 * - No new npm dependencies required.
 */

// Combined regex: capture group 1 → highlight, group 2 → underline.
// Non-greedy inner match prevents spanning across multiple markers.
const FORMAT_PATTERN = /==((?:(?!==).)+)==|\+\+((?:(?!\+\+).)+)\+\+/g

/**
 * Split a single text node into an array of text / mark / underline nodes.
 * Returns `null` when no patterns are found (caller keeps the original node).
 */
function splitTextNode(node: Text): PhrasingContent[] | null {
  const { value } = node
  const result: PhrasingContent[] = []
  let lastIndex = 0

  // Reset stateful regex
  FORMAT_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = FORMAT_PATTERN.exec(value)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      result.push({ type: 'text', value: value.slice(lastIndex, match.index) })
    }

    if (match[1] !== undefined) {
      // ==highlight== → <mark>
      result.push({
        type: 'mark',
        children: [{ type: 'text', value: match[1] }],
        data: { hName: 'mark' },
      } as unknown as PhrasingContent)
    } else if (match[2] !== undefined) {
      // ++underline++ → <u>
      result.push({
        type: 'underline',
        children: [{ type: 'text', value: match[2] }],
        data: { hName: 'u' },
      } as unknown as PhrasingContent)
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex === 0) {
    // No matches found
    return null
  }

  // Remaining text after the last match
  if (lastIndex < value.length) {
    result.push({ type: 'text', value: value.slice(lastIndex) })
  }

  return result
}

/**
 * Recursively walk the AST and replace text nodes that contain formatting
 * patterns with the expanded node list.  Code / inlineCode nodes are skipped.
 */
function transformChildren(node: Parent): void {
  if (!node.children) return

  const next: typeof node.children = []
  let changed = false

  for (const child of node.children) {
    // Never parse inside code
    if (child.type === 'code' || child.type === 'inlineCode') {
      next.push(child)
      continue
    }

    if (child.type === 'text') {
      const parts = splitTextNode(child as Text)
      if (parts) {
        next.push(...(parts as typeof node.children[number][]))
        changed = true
      } else {
        next.push(child)
      }
    } else {
      // Recurse into structural / inline nodes (paragraph, strong, emphasis…)
      if ('children' in child && Array.isArray((child as Parent).children)) {
        transformChildren(child as Parent)
      }
      next.push(child)
    }
  }

  if (changed) {
    node.children = next
  }
}

/** Remark plugin entry-point. */
export default function remarkTextFormatting() {
  return (tree: Root) => {
    transformChildren(tree as unknown as Parent)
  }
}
