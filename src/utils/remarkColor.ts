import type { Root, Text, PhrasingContent, Parent } from 'mdast'

/**
 * Remark plugin that transforms {color:KEY}text{/color} syntax
 * into custom AST nodes rendered as <span data-color="KEY"> elements.
 *
 * Security:
 * - Only whitelisted color keys are parsed (red, orange, yellow, green, blue, purple, gray).
 * - Non-whitelisted keys are left as plain text (no DOM output).
 * - No raw HTML, no dangerouslySetInnerHTML, no style attributes.
 * - Skips code blocks and inline code.
 * - Uses `data.hName` + `data.hProperties` for remark-rehype bridging.
 */

/** Allowed color keys — any key not in this set is ignored. */
export const COLOR_WHITELIST = new Set([
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray',
])

/**
 * Regex to match {color:KEY}text{/color}.
 * - Group 1: the color key
 * - Group 2: the inner text content
 * Non-greedy inner match prevents spanning across multiple markers.
 */
const COLOR_PATTERN = /\{color:([a-z]+)\}((?:(?!\{\/color\}).)+)\{\/color\}/g

/**
 * Split a text node into an array of text / colorText nodes.
 * Returns null when no color patterns are found.
 */
function splitTextNode(node: Text): PhrasingContent[] | null {
  const { value } = node
  const result: PhrasingContent[] = []
  let lastIndex = 0

  COLOR_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = COLOR_PATTERN.exec(value)) !== null) {
    const colorKey = match[1]!
    const innerText = match[2]!

    // Only parse whitelisted color keys
    if (!COLOR_WHITELIST.has(colorKey)) {
      continue
    }

    // Text before this match
    if (match.index > lastIndex) {
      result.push({ type: 'text', value: value.slice(lastIndex, match.index) })
    }

    // Create a colorText AST node
    result.push({
      type: 'colorText',
      children: [{ type: 'text', value: innerText }],
      data: {
        hName: 'span',
        hProperties: { 'data-color': colorKey, className: [`md-color-${colorKey}`] },
      },
    } as unknown as PhrasingContent)

    lastIndex = match.index + match[0].length
  }

  if (lastIndex === 0) {
    return null
  }

  // Remaining text after the last match
  if (lastIndex < value.length) {
    result.push({ type: 'text', value: value.slice(lastIndex) })
  }

  return result
}

/**
 * Recursively walk the AST and replace text nodes that contain color
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
export default function remarkColor() {
  return (tree: Root) => {
    transformChildren(tree as unknown as Parent)
  }
}
