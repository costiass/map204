import { create } from 'zustand'

import type { Point } from '@/types'

export interface PresenceEntry {
  userId: string
  name: string
  color: string
  avatarUrl: string | null
  /**
   * The pointer, in **world** coordinates. It is never written to the page and
   * never persisted: it lives only in the presence channel, so a cursor cannot
   * end up in someone's document or in anybody's undo history.
   */
  cursor: Point | null
  /** Which page the cursor was last seen on, so it can be hidden elsewhere. */
  pageId: string | null
}

interface PresenceStore {
  entries: PresenceEntry[]
  /** The person whose pointer the viewport is following, if any. */
  followingId: string | null
  setEntries: (entries: PresenceEntry[]) => void
  upsert: (entry: PresenceEntry) => void
  /** Apply a pointer move to whoever it belongs to. */
  moveCursor: (userId: string, point: Point, pageId: string) => void
  setFollowing: (userId: string | null) => void
  clear: () => void
}

/** Who else is in this document, and where their pointers are. */
export const usePresence = create<PresenceStore>()((set) => ({
  entries: [],
  followingId: null,

  setEntries: (entries) => set({ entries }),

  upsert: (entry) =>
    set((state) => {
      const index = state.entries.findIndex((e) => e.userId === entry.userId)
      if (index === -1) return { entries: [...state.entries, entry] }
      const next = [...state.entries]
      next[index] = { ...next[index], ...entry }
      return { entries: next }
    }),

  moveCursor: (userId, point, pageId) =>
    set((state) => {
      const index = state.entries.findIndex((e) => e.userId === userId)
      if (index === -1) return state
      const next = [...state.entries]
      next[index] = { ...next[index], cursor: point, pageId }
      return { entries: next }
    }),

  setFollowing: (followingId) => set({ followingId }),

  clear: () => set({ entries: [], followingId: null }),
}))

/** Stable colour per person, so the same face keeps the same cursor. */
const COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
]

export function colorFor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  }
  return COLORS[hash % COLORS.length]
}

/** The first word of a name, for a cursor label: "Ada Lovelace" becomes "Ada". */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/**
 * The letter to put in an avatar when there is no picture: the first letter of
 * the **first name**, not of the email address — "Ada Lovelace" gives A, and so
 * does "ada@example.com", but "brian@…" gives B rather than b.
 */
export function initialOf(name: string | null | undefined, email?: string | null): string {
  if (name?.trim()) return firstNameOf(name).charAt(0).toUpperCase()
  return (email ?? '?').trim().charAt(0).toUpperCase() || '?'
}
