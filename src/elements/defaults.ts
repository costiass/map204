import type { ConnectionStyle, NoteStyle } from './schema'

/**
 * The defaults a new element starts with.
 *
 * In one place, because there are three ways to make an element — the toolbar, the
 * context menu, a keyboard shortcut — and three copies of "what does a new note
 * look like" is three places for them to disagree.
 *
 * These are the *appearance* defaults. The document's own settings, which a user
 * can change and which travel with an export, are applied on top of these.
 */

export const DEFAULT_NOTE_STYLE: NoteStyle = {
  backgroundColor: '#ffffff',
  accentColor: '#6366F1',
  textColor: '#111827',
  borderColor: '#E5E7EB',
  borderWidth: 1,
  borderRadius: 12,
  shadow: true,
}

export const DEFAULT_CONNECTION_STYLE_V2: ConnectionStyle & { relationshipType: string } = {
  color: '#6366F1',
  width: 2,
  lineStyle: 'solid',
  routing: 'curved',
  arrowStart: 'none',
  arrowEnd: 'arrow',
  animated: false,
  relationshipType: 'related to',
}

/** A new element's size, before a type says otherwise. */
export const DEFAULT_ELEMENT_SIZE = { width: 280, height: 160 }

/**
 * A video's shape.
 *
 * 16:9, because that is what essentially every video is and what YouTube renders.
 * Overridden with the real shape when one is known, and kept as the value for a
 * video whose shape we have not seen — so a video element is never created with
 * a nonsense aspect and then stretched by a resizer.
 */
export const DEFAULT_VIDEO_ASPECT = 16 / 9

/** A table starts with a header row and two empty rows. Not one: one looks like
 *  a mistake, and a table is the thing you are most likely to want to write into. */
export const DEFAULT_TABLE_COLUMNS = 3
export const DEFAULT_TABLE_ROWS = 3
