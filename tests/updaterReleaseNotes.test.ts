import { describe, expect, it } from 'vitest'
import { normalizeUpdaterReleaseNotes, preserveUpdaterReleaseDetails } from '../electron/updaterReleaseNotes'
import { CURRENT_RELEASE_NOTES } from '../src/releaseNotes'
import packageJson from '../package.json'

describe('release notes', () => {
  it('bundles the current v1.13.0 summary for offline display', () => {
    expect(CURRENT_RELEASE_NOTES.version).toBe('1.13.0')
    expect(CURRENT_RELEASE_NOTES.version).toBe(packageJson.version)
    expect(CURRENT_RELEASE_NOTES.items.length).toBeGreaterThan(0)
    expect(CURRENT_RELEASE_NOTES.items.join('\n')).toContain('推荐下一步')
  })

  it('normalizes a remote string release note', () => {
    expect(normalizeUpdaterReleaseNotes('  Fixed update flow.  ')).toBe('Fixed update flow.')
  })

  it('normalizes full-changelog release note arrays', () => {
    expect(normalizeUpdaterReleaseNotes([
      { version: '1.11.3', note: 'Added local notes.' },
      { version: '1.11.2', note: null },
      { version: '1.11.1', note: 'Previous fix.' },
    ])).toBe('v1.11.3\nAdded local notes.\n\nv1.11.1\nPrevious fix.')
  })

  it.each([undefined, null, '', [], [{ note: null }], { note: 'ignored' }])(
    'returns undefined when remote release notes are unavailable',
    value => {
      expect(normalizeUpdaterReleaseNotes(value)).toBeUndefined()
    },
  )

  it('preserves release details while download status advances', () => {
    expect(preserveUpdaterReleaseDetails(
      {
        status: 'available',
        version: '1.12.0',
        releaseNotes: 'New notes',
        releaseDate: '2026-06-20T08:00:00.000Z',
      },
      { status: 'downloading', percent: 42 },
    )).toEqual({
      status: 'downloading',
      version: '1.12.0',
      releaseNotes: 'New notes',
      releaseDate: '2026-06-20T08:00:00.000Z',
      percent: 42,
    })
  })
})
