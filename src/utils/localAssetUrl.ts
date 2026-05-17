const WINDOWS_ABSOLUTE_PATH = /^\/?[A-Za-z]:\//

export function toLocalAssetUrl(reference: string | null | undefined, directory?: 'attachments' | 'mistake_images'): string {
  if (!reference || typeof reference !== 'string') return ''

  const trimmed = reference.trim()
  if (!trimmed || trimmed.includes('\0')) return ''
  if (trimmed.startsWith('local://')) return trimmed

  const normalized = trimmed.replace(/\\/g, '/')

  if (WINDOWS_ABSOLUTE_PATH.test(normalized)) {
    const pathWithLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
    return `local://${encodeURI(pathWithLeadingSlash)}`
  }

  const withoutLeadingSlash = normalized.replace(/^\/+/, '')
  const parts = withoutLeadingSlash.split('/').filter(Boolean)

  if (parts.some(part => part === '..')) return ''

  const assetParts = directory && parts.length === 1 ? [directory, parts[0]!] : parts
  if (assetParts.length === 0) return ''

  return `local://${assetParts.map(part => encodeURIComponent(part)).join('/')}`
}
