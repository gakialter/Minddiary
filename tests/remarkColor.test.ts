import { describe, expect, it } from 'vitest'
import remarkColor, { COLOR_WHITELIST } from '../src/utils/remarkColor'
import type { Root, Paragraph, Text } from 'mdast'

/** Helper: build a minimal AST with a single paragraph containing one text node. */
function makeTree(text: string): Root {
  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: text }],
      },
    ],
  }
}

/** Helper: run the plugin and return the paragraph's children. */
function transformAndGetChildren(text: string) {
  const tree = makeTree(text)
  const transform = remarkColor()
  transform(tree)
  const para = tree.children[0] as Paragraph
  return para.children
}

describe('remarkColor', () => {
  // ── Whitelist colors ─────────────────────────────────────────────────

  it('transforms {color:red}text{/color} into a colorText node', () => {
    const children = transformAndGetChildren('{color:red}重点{/color}')
    expect(children).toHaveLength(1)
    const node = children[0] as any
    expect(node.type).toBe('colorText')
    expect(node.data.hName).toBe('span')
    expect(node.data.hProperties['data-color']).toBe('red')
    expect(node.data.hProperties.className).toEqual(['md-color-red'])
    expect(node.children[0].value).toBe('重点')
  })

  it.each([...COLOR_WHITELIST])('transforms whitelisted color "%s"', (color) => {
    const children = transformAndGetChildren(`{color:${color}}text{/color}`)
    expect(children).toHaveLength(1)
    const node = children[0] as any
    expect(node.type).toBe('colorText')
    expect(node.data.hProperties['data-color']).toBe(color)
    expect(node.data.hProperties.className).toEqual([`md-color-${color}`])
  })

  // ── Non-whitelist colors ─────────────────────────────────────────────

  it('does NOT transform non-whitelisted color keys', () => {
    const children = transformAndGetChildren('{color:evil}hack{/color}')
    expect(children).toHaveLength(1)
    const node = children[0] as Text
    expect(node.type).toBe('text')
    expect(node.value).toBe('{color:evil}hack{/color}')
  })

  // ── Injection attack vectors ─────────────────────────────────────────

  it('does NOT transform {color:#ff0000}', () => {
    const children = transformAndGetChildren('{color:#ff0000}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
    expect((children[0] as Text).value).toContain('{color:#ff0000}')
  })

  it('does NOT transform {color:rgb(255,0,0)}', () => {
    const children = transformAndGetChildren('{color:rgb(255,0,0)}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('does NOT transform {color:hsl(0,100%,50%)}', () => {
    const children = transformAndGetChildren('{color:hsl(0,100%,50%)}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('does NOT transform {color:var(--danger)}', () => {
    const children = transformAndGetChildren('{color:var(--danger)}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('does NOT transform {color:url(evil)}', () => {
    const children = transformAndGetChildren('{color:url(javascript:alert(1))}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('does NOT transform {color:expression(alert(1))}', () => {
    const children = transformAndGetChildren('{color:expression(alert(1))}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('does NOT transform {color:red;position:absolute}', () => {
    // semicolons and extra CSS won't match [a-z]+ regex
    const children = transformAndGetChildren('{color:red;position:absolute}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('does NOT transform color keys with uppercase letters', () => {
    const children = transformAndGetChildren('{color:Red}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('does NOT transform color keys with numbers', () => {
    const children = transformAndGetChildren('{color:red1}text{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  // ── Multiple colors in one line ──────────────────────────────────────

  it('handles multiple color markers in one text node', () => {
    const children = transformAndGetChildren(
      '前缀{color:red}红色{/color}中间{color:blue}蓝色{/color}后缀',
    )
    expect(children).toHaveLength(5)
    expect((children[0] as Text).value).toBe('前缀')
    expect((children[1] as any).data.hProperties['data-color']).toBe('red')
    expect((children[1] as any).children[0].value).toBe('红色')
    expect((children[2] as Text).value).toBe('中间')
    expect((children[3] as any).data.hProperties['data-color']).toBe('blue')
    expect((children[3] as any).children[0].value).toBe('蓝色')
    expect((children[4] as Text).value).toBe('后缀')
  })

  // ── Mixed whitelisted and non-whitelisted ────────────────────────────

  it('skips non-whitelisted while processing whitelisted in same text', () => {
    const children = transformAndGetChildren(
      '{color:evil}bad{/color} {color:green}good{/color}',
    )
    const colorNodes = children.filter((c: any) => c.type === 'colorText')
    expect(colorNodes.length).toBe(1)
    expect((colorNodes[0] as any).data.hProperties['data-color']).toBe('green')
    // Non-whitelisted part should be preserved as plain text
    const textNodes = children.filter((c: any) => c.type === 'text')
    const textContent = textNodes.map((n: any) => n.value).join('')
    expect(textContent).toContain('{color:evil}bad{/color}')
  })

  // ── Code safety ──────────────────────────────────────────────────────

  it('does NOT parse inside inline code', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'inlineCode', value: '{color:red}not colored{/color}' },
          ],
        },
      ],
    }
    const transform = remarkColor()
    transform(tree)
    const para = tree.children[0] as Paragraph
    expect(para.children).toHaveLength(1)
    expect(para.children[0]!.type).toBe('inlineCode')
  })

  it('does NOT parse inside code blocks', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'code',
          value: '{color:red}not colored{/color}',
        } as any,
      ],
    }
    const transform = remarkColor()
    transform(tree)
    expect(tree.children[0]!.type).toBe('code')
  })

  // ── Text with no color markers ───────────────────────────────────────

  it('leaves plain text unchanged', () => {
    const children = transformAndGetChildren('no markers here')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
    expect((children[0] as Text).value).toBe('no markers here')
  })

  it('handles empty string', () => {
    const children = transformAndGetChildren('')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).value).toBe('')
  })

  // ── Edge cases ───────────────────────────────────────────────────────

  it('handles unclosed color tag as plain text', () => {
    const children = transformAndGetChildren('{color:red}no closing tag')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('handles color tag with empty content', () => {
    const children = transformAndGetChildren('{color:red}{/color}')
    expect(children).toHaveLength(1)
    expect((children[0] as Text).type).toBe('text')
  })

  it('does not lose user content when color tag is malformed', () => {
    const input = '{color:red}text without closing tag and more text'
    const children = transformAndGetChildren(input)
    expect(children).toHaveLength(1)
    expect((children[0] as Text).value).toBe(input)
  })

  // ── Whitelist set ────────────────────────────────────────────────────

  it('exports exactly 7 whitelisted colors', () => {
    expect(COLOR_WHITELIST.size).toBe(7)
    expect(COLOR_WHITELIST.has('red')).toBe(true)
    expect(COLOR_WHITELIST.has('orange')).toBe(true)
    expect(COLOR_WHITELIST.has('yellow')).toBe(true)
    expect(COLOR_WHITELIST.has('green')).toBe(true)
    expect(COLOR_WHITELIST.has('blue')).toBe(true)
    expect(COLOR_WHITELIST.has('purple')).toBe(true)
    expect(COLOR_WHITELIST.has('gray')).toBe(true)
  })
})
