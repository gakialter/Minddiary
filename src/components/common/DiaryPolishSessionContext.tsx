import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { PolishReview } from './useDiaryPolish'

// Candidate text lives only in this application instance. It is never part of
// diary data, chat history, or browser storage.
const DiaryPolishSessionContext = createContext<Map<string, PolishReview> | null>(null)

export function DiaryPolishSessionProvider({ children }: { children: ReactNode }) {
  const sessions = useRef(new Map<string, PolishReview>())
  useEffect(() => () => { sessions.current.clear() }, [])
  return <DiaryPolishSessionContext.Provider value={sessions.current}>{children}</DiaryPolishSessionContext.Provider>
}

export function useDiaryPolishSessions() {
  const shared = useContext(DiaryPolishSessionContext)
  const local = useRef(new Map<string, PolishReview>())
  return shared ?? local.current
}
