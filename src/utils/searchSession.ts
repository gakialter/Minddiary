export interface SearchFilters {
  mood: string
  startDate: string
  endDate: string
  tagId: number | null
}

export interface SearchIntent { query: string; filters: SearchFilters }
export interface SearchSessionState extends SearchIntent { submitted: SearchIntent | null }

export const createSearchSession = (): SearchSessionState => ({
  query: '', filters: { mood: '', startDate: '', endDate: '', tagId: null }, submitted: null,
})
