import type { Tag, TagPattern, TagVariant } from '../types'

export const DEFAULT_TAG_COLOR = '#0F766E'
export const DEFAULT_TAG_ICON = ''
export const DEFAULT_TAG_VARIANT: TagVariant = 'soft'
export const DEFAULT_TAG_PATTERN: TagPattern = 'none'

export const TAG_VARIANTS = ['solid', 'soft', 'outline', 'ghost'] as const satisfies readonly TagVariant[]
export const TAG_PATTERNS = ['none', 'dots', 'stripes', 'grid', 'leaf'] as const satisfies readonly TagPattern[]

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function normalizeTagColor(color: unknown): string {
  if (typeof color === 'string' && HEX_COLOR_RE.test(color.trim())) {
    return color.trim()
  }
  return DEFAULT_TAG_COLOR
}

export function normalizeTagIcon(icon: unknown): string {
  if (typeof icon !== 'string') return DEFAULT_TAG_ICON
  return Array.from(icon.trim()).slice(0, 4).join('')
}

export function normalizeTagVariant(variant: unknown): TagVariant {
  return TAG_VARIANTS.includes(variant as TagVariant) ? variant as TagVariant : DEFAULT_TAG_VARIANT
}

export function normalizeTagPattern(pattern: unknown): TagPattern {
  return TAG_PATTERNS.includes(pattern as TagPattern) ? pattern as TagPattern : DEFAULT_TAG_PATTERN
}

export function normalizeTagName(name: unknown): string {
  return typeof name === 'string' ? name.trim() : ''
}

export function normalizeTag(tag: Pick<Tag, 'id'> & Partial<Tag>): Tag {
  return {
    id: tag.id,
    name: normalizeTagName(tag.name),
    color: normalizeTagColor(tag.color),
    icon: normalizeTagIcon(tag.icon),
    variant: normalizeTagVariant(tag.variant),
    pattern: normalizeTagPattern(tag.pattern),
  }
}

export function normalizeTagList(tags: Tag[]): Tag[] {
  return tags.map(normalizeTag)
}

export function mergeTagPatch(base: Tag, patch: Partial<Tag>): Tag {
  return normalizeTag({
    id: base.id,
    name: patch.name !== undefined ? patch.name : base.name,
    color: patch.color !== undefined ? patch.color : base.color,
    icon: patch.icon !== undefined ? patch.icon : base.icon,
    variant: patch.variant !== undefined ? patch.variant : base.variant,
    pattern: patch.pattern !== undefined ? patch.pattern : base.pattern,
  })
}
