import type { CSSProperties } from 'react'
import type { Tag, TagPattern, TagVariant } from '../types'
import { normalizeTag } from '../utils/tagStyle'

interface TagBadgeProps {
  tag: Tag
  selected?: boolean
  interactive?: boolean
  size?: 'sm' | 'md'
}

const alphaPattern = (color: string) => `color-mix(in srgb, ${color} 26%, transparent)`

const patternBackgrounds: Record<TagPattern, (color: string) => Pick<CSSProperties, 'backgroundImage' | 'backgroundSize'>> = {
  none: () => ({}),
  dots: (color) => ({
    backgroundImage: `radial-gradient(${alphaPattern(color)} 1px, transparent 1px)`,
    backgroundSize: '7px 7px',
  }),
  stripes: (color) => ({
    backgroundImage: `repeating-linear-gradient(45deg, ${alphaPattern(color)} 0 1px, transparent 1px 7px)`,
  }),
  grid: (color) => ({
    backgroundImage: [
      `linear-gradient(${alphaPattern(color)} 1px, transparent 1px)`,
      `linear-gradient(90deg, ${alphaPattern(color)} 1px, transparent 1px)`,
    ].join(', '),
    backgroundSize: '8px 8px',
  }),
  leaf: (color) => ({
    backgroundImage: [
      `radial-gradient(ellipse at 20% 30%, ${alphaPattern(color)} 0 18%, transparent 20%)`,
      `radial-gradient(ellipse at 78% 72%, ${alphaPattern(color)} 0 16%, transparent 18%)`,
    ].join(', '),
    backgroundSize: '14px 14px',
  }),
}

function getSolidTextColor(hexColor: string): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16)
  const green = Number.parseInt(hexColor.slice(3, 5), 16)
  const blue = Number.parseInt(hexColor.slice(5, 7), 16)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.62 ? '#1F2937' : '#FFFFFF'
}

function getVariantStyle(variant: TagVariant, color: string): Pick<CSSProperties, 'backgroundColor' | 'borderColor' | 'color'> {
  switch (variant) {
    case 'solid':
      return {
        backgroundColor: color,
        borderColor: color,
        color: getSolidTextColor(color),
      }
    case 'outline':
      return {
        backgroundColor: 'transparent',
        borderColor: color,
        color,
      }
    case 'ghost':
      return {
        backgroundColor: `color-mix(in srgb, ${color} 7%, transparent)`,
        borderColor: 'transparent',
        color,
      }
    case 'soft':
    default:
      return {
        backgroundColor: `color-mix(in srgb, ${color} 13%, var(--bg-secondary))`,
        borderColor: `color-mix(in srgb, ${color} 42%, var(--border))`,
        color,
      }
  }
}

function TagBadge({ tag, selected = false, interactive = false, size = 'sm' }: TagBadgeProps) {
  const normalizedTag = normalizeTag(tag)
  const color = normalizedTag.color
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: size === 'sm' ? 4 : 6,
    minHeight: size === 'sm' ? 22 : 28,
    maxWidth: '100%',
    padding: size === 'sm' ? '2px 8px' : '4px 10px',
    border: '1px solid',
    borderRadius: 999,
    fontSize: size === 'sm' ? 12 : 13,
    fontWeight: 600,
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    userSelect: 'none',
    cursor: interactive ? 'pointer' : 'default',
    boxShadow: selected ? `0 0 0 2px color-mix(in srgb, ${color} 24%, transparent)` : undefined,
    transition: interactive ? 'border-color 0.15s, box-shadow 0.15s, background-color 0.15s' : undefined,
    ...getVariantStyle(normalizedTag.variant ?? 'soft', color),
    ...patternBackgrounds[normalizedTag.pattern ?? 'none'](color),
  }

  return (
    <span
      className="tag-badge"
      data-testid={`tag-badge-${normalizedTag.id}`}
      style={style}
      title={normalizedTag.name}
    >
      {normalizedTag.icon && (
        <span aria-hidden="true" style={{ flexShrink: 0 }}>
          {normalizedTag.icon}
        </span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{normalizedTag.name}</span>
    </span>
  )
}

export default TagBadge
