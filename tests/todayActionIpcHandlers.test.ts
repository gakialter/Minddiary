import { describe, expect, it, vi } from 'vitest'
import { createTodayActionIpcHandlers } from '../electron/todayActionIpc'

describe('Today Action C7 IPC handlers', () => {
  it('rejects every untrusted sender before any authoritative read or token/status operation', () => {
    const readChapterContext = vi.fn()
    const authorizeStaleReview = vi.fn()
    const getCommittedStatus = vi.fn()
    const handlers = createTodayActionIpcHandlers({
      isTrustedSender: () => false,
      readChapterContext,
      authorizeStaleReview,
      getCommittedStatus,
    })
    const event = { sender: {} }

    expect(() => handlers.getAuthoritativeChapterContext(event)).toThrow('rejected')
    expect(() => handlers.authorizeStaleReview(event, { secret: 'must not be read' })).toThrow('rejected')
    expect(() => handlers.getCommittedStatus(event, { secret: 'must not be read' })).toThrow('rejected')
    expect(readChapterContext).not.toHaveBeenCalled()
    expect(authorizeStaleReview).not.toHaveBeenCalled()
    expect(getCommittedStatus).not.toHaveBeenCalled()
  })

  it('binds stale authorization to the exact trusted sender object and forwards bounded requests', () => {
    const sender = {}
    const chapterContext = {
      chapterProjection: { chapter_progress: [] },
      currentChapterSignature: 'a'.repeat(64),
    }
    const readChapterContext = vi.fn(() => chapterContext)
    const authorizeStaleReview = vi.fn(() => ({ staleReviewToken: 'b'.repeat(64) }))
    const getCommittedStatus = vi.fn(() => ({
      status: 'NOT_COMMITTED' as const,
      operationId: '11111111-1111-4111-8111-111111111111',
    }))
    const handlers = createTodayActionIpcHandlers({
      isTrustedSender: event => event.sender === sender,
      readChapterContext,
      authorizeStaleReview,
      getCommittedStatus,
    })
    const event = { sender }
    const authorizationRequest = { operationId: 'authorization' }
    const statusRequest = { operationId: 'status' }

    expect(handlers.getAuthoritativeChapterContext(event)).toBe(chapterContext)
    expect(handlers.authorizeStaleReview(event, authorizationRequest)).toEqual({
      staleReviewToken: 'b'.repeat(64),
    })
    expect(authorizeStaleReview).toHaveBeenCalledWith(authorizationRequest, sender)
    expect(handlers.getCommittedStatus(event, statusRequest)).toEqual({
      status: 'NOT_COMMITTED',
      operationId: '11111111-1111-4111-8111-111111111111',
    })
    expect(getCommittedStatus).toHaveBeenCalledWith(statusRequest)
  })
})
