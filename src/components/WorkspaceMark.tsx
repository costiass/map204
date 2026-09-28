import {
  BookOpen,
  Brain,
  Calculator,
  Code,
  FlaskConical,
  Globe,
  GraduationCap,
  Languages,
  LayoutGrid,
  Library,
  Lightbulb,
  Map,
  Microscope,
  Music,
  Palette,
  Presentation,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { getWorkspaceAccent, type WorkspaceAccentId } from '@/theme'

/**
 * The lucide icon set a workspace may use.
 *
 * Keyed by the same ids stored in `documents.icon` and constrained by
 * `documents_icon_check`. A missing key is not a crash: it falls back to the
 * generic grid, so a workspace written by a newer version of the app still
 * renders something sensible in an older one.
 */
const ICONS: Record<string, LucideIcon> = {
  'layout-grid': LayoutGrid,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  'flask-conical': FlaskConical,
  globe: Globe,
  calculator: Calculator,
  microscope: Microscope,
  languages: Languages,
  palette: Palette,
  music: Music,
  code: Code,
  map: Map,
  lightbulb: Lightbulb,
  presentation: Presentation,
  brain: Brain,
  library: Library,
}

export interface WorkspaceMarkProps {
  icon: string | null | undefined
  accent: string | null | undefined
  size?: number
  className?: string
}

/**
 * A workspace's icon, painted in its own colour.
 *
 * The colour comes from the theme rather than a hard-coded hex, so it stays
 * legible when the reader switches to dark mode and stays in step with every
 * other coloured surface in the app.
 */
export function WorkspaceMark({
  icon,
  accent,
  size = 16,
  className,
}: WorkspaceMarkProps) {
  const Glyph = ICONS[icon ?? ''] ?? LayoutGrid
  const tone = getWorkspaceAccent(accent as WorkspaceAccentId)

  return <Glyph size={size} style={{ color: tone.ink }} className={className} aria-hidden="true" />
}

/** A filled dot in a workspace's colour — for lists and rows. */
export function WorkspaceDot({
  accent,
  size = 10,
  className,
}: {
  accent: string | null | undefined
  size?: number
  className?: string
}) {
  const tone = getWorkspaceAccent(accent as WorkspaceAccentId)
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${className ?? ''}`}
      style={{ width: size, height: size, background: tone.base }}
    />
  )
}
