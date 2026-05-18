import type { DiaryEntry } from '../types'

const htmlTagPattern = /<[^>]*>/g
const htmlSpacePattern = /&(?:nbsp|ensp|emsp|thinsp|zwnj|zwj);|&#160;|&#xA0;/gi
const markdownImagePattern = /!\[[^\]]*]\([^)]*\)/g
const markdownLinkPattern = /\[([^\]]*)]\([^)]*\)/g
const markdownSyntaxPattern = /[`*_~>#\-+=[\]{}()|\\.:;!?，。！？、“”‘’"']/g

function meaningfulText(value: string | null | undefined): string {
  return (value || '')
    .replace(markdownImagePattern, ' ')
    .replace(markdownLinkPattern, '$1')
    .replace(htmlTagPattern, ' ')
    .replace(htmlSpacePattern, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(markdownSyntaxPattern, ' ')
    .replace(/\s+/g, '')
    .trim()
}

export function isBlankDiaryEntry(entry: DiaryEntry): boolean {
  if (Array.isArray(entry.tags) && entry.tags.length > 0) return false
  if (Array.isArray(entry.images) && entry.images.length > 0) return false

  const hasLoadedContent = typeof entry.content === 'string' || typeof entry.content_snippet === 'string'
  if (!hasLoadedContent && (entry.word_count || 0) > 0) return false

  const title = meaningfulText(entry.title)
  const content = meaningfulText(entry.content || entry.content_snippet || '')

  return title.length === 0 && content.length === 0
}
