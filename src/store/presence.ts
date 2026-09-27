import { create } from 'zustand'

export interface PresenceEntry {
  userId: string
  name: string
  color: string
  avatarUrl: string | null
}

interface PresenceStore {
  entries: PresenceEntry[]
  setEntries: (entries: PresenceEntry[]) => void
  clear: () => void
}

/** Who else has this document open, from the `document:<id>` presence channel. */
export const usePresence = create<PresenceStore>()((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries }),
  clear: () => set({ entries: [] }),
}))

/** Stable colour per person, so the same face keeps the same dot. */
const COLORS = [
  '#6366F1',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
]

export function colorFor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return COLORS[hash % COLORS.length]
}
