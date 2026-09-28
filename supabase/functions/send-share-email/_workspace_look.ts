/**
 * The workspace colour and icon tables, for the Edge Function.
 *
 * These mirror `src/theme.ts`. They are duplicated rather than imported because
 * an Edge Function is bundled separately from the app and cannot reach into
 * `src/`. The duplication is guarded by `scripts/test-workspace-look.cjs`, which
 * fails the build if the two ever disagree — an unknown accent in an email would
 * render as a colour nobody chose.
 */

/** Accent token → the hex used for a filled surface. Matches `Accent.base`. */
export const WORKSPACE_ACCENT_HEX: Record<string, string> = {
  indigo: '#6366f1',
  violet: '#8b5cf6',
  blue: '#3b82f6',
  teal: '#0d9488',
  green: '#16a34a',
  amber: '#d97706',
  rose: '#e11d48',
  slate: '#64748b',
}

/** Icon id → the label shown next to the workspace name. */
export const ICON_LABELS: Record<string, string> = {
  'layout-grid': 'General',
  'book-open': 'Reading',
  'graduation-cap': 'Course',
  'flask-conical': 'Science',
  globe: 'Geography',
  calculator: 'Maths',
  microscope: 'Biology',
  languages: 'Languages',
  palette: 'Art',
  music: 'Music',
  code: 'Computing',
  map: 'Maps',
  lightbulb: 'Ideas',
  presentation: 'Seminar',
  brain: 'Theory',
  library: 'Research',
}
