/**
 * The one place colour is decided.
 *
 * Every surface, border, label and accent in the app resolves to a token here.
 * Components never name a colour — they use the semantic utilities Tailwind
 * generates from these (`bg-surface`, `text-ink`, `border-line`, `text-brand`,
 * …), so light and dark are the *same* component tree with different variable
 * values, not two sets of `dark:` overrides.
 *
 * The accent is the one exception: card contents keep whatever colour the user
 * picked for a card, because that is data, not chrome.
 */

export type ThemeMode = 'light' | 'dark'
export type AccentId = 'indigo' | 'violet' | 'blue' | 'teal' | 'green' | 'amber' | 'rose'
export type ThemePalette = 'default' | 'metallic' | 'fluffy' | 'contrast'

export interface Accent {
  id: AccentId
  label: string
  /** The colour a filled button and a focus ring use. */
  base: string
  /** One step down, for hover. */
  hover: string
  /** Tinted background, for selected chips and soft badges. */
  soft: string
  /** Text colour that sits on `base`. */
  onBase: string
  /** Text/icon colour for accents on a light background. */
  ink: string
}

/**
 * Accents are chosen to stay legible in both modes: `base` reads as a button in
 * light mode and as a muted fill in dark mode, where `hover` carries the
 * emphasis instead.
 */
export const ACCENTS: Accent[] = [
  { id: 'indigo', label: 'Indigo', base: '#6366f1', hover: '#4f46e5', soft: '#eef2ff', onBase: '#ffffff', ink: '#4338ca' },
  { id: 'violet', label: 'Violet', base: '#8b5cf6', hover: '#7c3aed', soft: '#f5f3ff', onBase: '#ffffff', ink: '#6d28d9' },
  { id: 'blue', label: 'Blue', base: '#3b82f6', hover: '#2563eb', soft: '#eff6ff', onBase: '#ffffff', ink: '#1d4ed8' },
  { id: 'teal', label: 'Teal', base: '#0d9488', hover: '#0f766e', soft: '#f0fdfa', onBase: '#ffffff', ink: '#0f766e' },
  { id: 'green', label: 'Green', base: '#16a34a', hover: '#15803d', soft: '#f0fdf4', onBase: '#ffffff', ink: '#15803d' },
  { id: 'amber', label: 'Amber', base: '#d97706', hover: '#b45309', soft: '#fffbeb', onBase: '#ffffff', ink: '#b45309' },
  { id: 'rose', label: 'Rose', base: '#e11d48', hover: '#be123c', soft: '#fff1f2', onBase: '#ffffff', ink: '#be123c' },
]

export const DEFAULT_ACCENT: AccentId = 'indigo'

export function getAccent(id: string | null | undefined): Accent {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0]
}

export interface ThemeTokens {
  /** Page background behind the canvas. */
  canvas: string
  /** Cards, panels, sheets. */
  surface: string
  /** A surface sitting on a surface: menus, hovered rows, sidebars. */
  surfaceAlt: string
  /** Recessed: the grid backdrop, empty wells. */
  surfaceSunken: string
  /** Primary text. */
  ink: string
  /** Headings and anything meant to outrank body text. */
  inkStrong: string
  /** Secondary text, timestamps, placeholders. */
  muted: string
  /** Hairlines and dividers. */
  line: string
  /** Stronger border, for focus and drag targets. */
  lineStrong: string
  /** Danger text and fills. */
  danger: string
  dangerSoft: string
  /** Positive confirmation. */
  success: string
  /** Scrim behind modals. */
  scrim: string
  /** Shadows, as one string. */
  shadowSm: string
  shadowMd: string
  shadowLg: string
  /** Markdown code blocks and other inverted wells. */
  codeBg: string
  codeInk: string
}

/**
 * The neutrals a palette replaces. Every palette keeps the same *relationships*
 * (surface above canvas, ink above muted above line), so the component tree
 * never has to know which one is active.
 */
type NeutralKey =
  | 'canvas'
  | 'surface'
  | 'surfaceAlt'
  | 'surfaceSunken'
  | 'ink'
  | 'inkStrong'
  | 'muted'
  | 'line'
  | 'lineStrong'

type Neutrals = Record<NeutralKey, string>

/** How a palette changes the neutrals, per mode. */
export interface Palette {
  id: ThemePalette
  label: string
  /** One line, shown under the swatch. */
  hint: string
  light: Partial<Neutrals>
  dark: Partial<Neutrals>
}

export const PALETTES: Palette[] = [
  {
    id: 'default',
    label: 'Classic',
    hint: 'Neutral greys, the everyday look',
    light: {},
    dark: {},
  },
  {
    id: 'metallic',
    label: 'Metallic',
    hint: 'Cool steel with a tight specular edge',
    light: {
      canvas: '#dfe4ea',
      surface: '#f7f9fb',
      surfaceAlt: '#eef2f6',
      surfaceSunken: '#e4e9ef',
      ink: '#243040',
      inkStrong: '#0b1522',
      muted: '#5c6b7d',
      line: '#cbd5e1',
      lineStrong: '#a8b6c6',
    },
    dark: {
      canvas: '#0b0e13',
      surface: '#161a21',
      surfaceAlt: '#1d222b',
      surfaceSunken: '#07090d',
      ink: '#c3ccd8',
      inkStrong: '#eef3f9',
      muted: '#7d8a9a',
      line: '#262d38',
      lineStrong: '#3b4553',
    },
  },
  {
    id: 'fluffy',
    label: 'Fluffy',
    hint: 'Warm paper, soft corners, gentle contrast',
    light: {
      canvas: '#fdf3e7',
      surface: '#fffdfa',
      surfaceAlt: '#fdf6ec',
      surfaceSunken: '#f7ebdb',
      ink: '#5a4636',
      inkStrong: '#3d2f23',
      muted: '#96795f',
      line: '#f0e2d0',
      lineStrong: '#e0cbb2',
    },
    dark: {
      canvas: '#171310',
      surface: '#241d18',
      surfaceAlt: '#2c231c',
      surfaceSunken: '#0f0c0a',
      ink: '#e3d5c6',
      inkStrong: '#fbf5ee',
      muted: '#a8917c',
      line: '#332a22',
      lineStrong: '#4a3d31',
    },
  },
  {
    id: 'contrast',
    label: 'Contrast',
    hint: 'Near-black on white, for bright rooms',
    light: {
      canvas: '#ffffff',
      surface: '#ffffff',
      surfaceAlt: '#f4f4f5',
      surfaceSunken: '#ebebed',
      ink: '#111111',
      inkStrong: '#000000',
      muted: '#4a4a4a',
      line: '#c9c9cc',
      lineStrong: '#111111',
    },
    dark: {
      canvas: '#000000',
      surface: '#0b0b0b',
      surfaceAlt: '#151515',
      surfaceSunken: '#000000',
      ink: '#f2f2f2',
      inkStrong: '#ffffff',
      muted: '#b4b4b4',
      line: '#3d3d3d',
      lineStrong: '#8a8a8a',
    },
  },
]

export const DEFAULT_PALETTE: ThemePalette = 'default'

export function getPalette(id: string | null | undefined): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0]
}

/**
 * Light values. Dark is not a copy with inverted numbers: it keeps the same
 * relationships (surface above canvas, ink above muted) with the greys moved to
 * true neutrals, so a card still reads as a card in both modes.
 */
const LIGHT: ThemeTokens = {
  canvas: '#eef1f6',
  surface: '#ffffff',
  surfaceAlt: '#f8fafc',
  surfaceSunken: '#f1f5f9',
  ink: '#1e293b',
  inkStrong: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  lineStrong: '#cbd5e1',
  danger: '#b91c1c',
  dangerSoft: '#fef2f2',
  success: '#15803d',
  scrim: 'rgba(15, 23, 42, 0.42)',
  shadowSm: '0 1px 2px rgba(15, 23, 42, 0.06)',
  shadowMd: '0 6px 16px -4px rgba(15, 23, 42, 0.14), 0 2px 6px -2px rgba(15, 23, 42, 0.08)',
  shadowLg: '0 18px 40px -12px rgba(15, 23, 42, 0.28)',
  codeBg: '#0f172a',
  codeInk: '#e2e8f0',
}

const DARK: ThemeTokens = {
  canvas: '#111111',
  surface: '#1a1a1a',
  surfaceAlt: '#222222',
  surfaceSunken: '#0d0d0d',
  ink: '#d4d4d4',
  inkStrong: '#f5f5f5',
  muted: '#8f8f8f',
  line: '#2a2a2a',
  lineStrong: '#3f3f3f',
  danger: '#f87171',
  dangerSoft: '#2a1414',
  success: '#4ade80',
  scrim: 'rgba(0, 0, 0, 0.6)',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.4)',
  shadowMd: '0 6px 16px -4px rgba(0, 0, 0, 0.6), 0 2px 6px -2px rgba(0, 0, 0, 0.4)',
  shadowLg: '0 18px 40px -12px rgba(0, 0, 0, 0.7)',
  codeBg: '#0a0a0a',
  codeInk: '#e2e8f0',
}

export function tokensFor(mode: ThemeMode, palette: ThemePalette = 'default'): ThemeTokens {
  const base = mode === 'dark' ? DARK : LIGHT
  const override = getPalette(palette)[mode]
  return { ...base, ...override }
}

export interface Appearance {
  mode: ThemeMode
  palette: ThemePalette
  accent: AccentId
  cardRadius: number
  reduceMotion: boolean
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'light',
  palette: DEFAULT_PALETTE,
  accent: DEFAULT_ACCENT,
  cardRadius: 12,
  reduceMotion: false,
}

/** `--cc-*` name → value, written to the document root. */
export function cssVariables(appearance: Appearance): Record<string, string> {
  const tokens = tokensFor(appearance.mode, appearance.palette)
  const accent = getAccent(appearance.accent)
  const palette = getPalette(appearance.palette)
  const dark = appearance.mode === 'dark'

  return {
    '--cc-canvas': tokens.canvas,
    '--cc-surface': tokens.surface,
    '--cc-surface-alt': tokens.surfaceAlt,
    '--cc-surface-sunken': tokens.surfaceSunken,
    '--cc-ink': tokens.ink,
    '--cc-ink-strong': tokens.inkStrong,
    '--cc-muted': tokens.muted,
    '--cc-line': tokens.line,
    '--cc-line-strong': tokens.lineStrong,
    '--cc-danger': tokens.danger,
    '--cc-danger-soft': tokens.dangerSoft,
    '--cc-success': tokens.success,
    '--cc-scrim': tokens.scrim,
    '--cc-shadow-sm': tokens.shadowSm,
    '--cc-shadow-md': tokens.shadowMd,
    '--cc-shadow-lg': tokens.shadowLg,
    '--cc-code-bg': tokens.codeBg,
    '--cc-code-ink': tokens.codeInk,

    // In dark mode the accent is a muted fill and `hover` carries the emphasis,
    // so the same token reads correctly in both modes.
    '--cc-brand': dark ? `color-mix(in srgb, ${accent.base} 78%, ${tokens.surface})` : accent.base,
    '--cc-brand-hover': dark
      ? `color-mix(in srgb, ${accent.base} 95%, ${tokens.inkStrong})`
      : accent.hover,
    '--cc-brand-soft': dark ? `color-mix(in srgb, ${accent.base} 22%, ${tokens.surface})` : accent.soft,
    '--cc-brand-ink': dark ? `color-mix(in srgb, ${accent.base} 55%, ${tokens.inkStrong})` : accent.ink,
    '--cc-on-brand': accent.onBase,

    '--cc-radius-card': `${appearance.cardRadius}px`,
    '--cc-motion': appearance.reduceMotion ? '0ms' : '190ms',

    // A palette can ask for a different default corner, but the user's slider
    // always wins once they touch it.
    '--cc-radius-ui': palette.id === 'fluffy' ? '12px' : '8px',
  }
}

/**
 * Writes the variables onto the document root. Called whenever appearance
 * changes, and once on boot, so the very first paint is already themed — no
 * flash of the wrong mode.
 */
export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(cssVariables(appearance))) {
    root.style.setProperty(name, value)
  }
  root.classList.toggle('dark', appearance.mode === 'dark')
  root.dataset.motion = appearance.reduceMotion ? 'reduced' : 'full'
  root.style.colorScheme = appearance.mode
}
