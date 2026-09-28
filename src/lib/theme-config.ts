// Type definitions for the theme system
export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentColor = 'nori' | 'violet' | 'rose' | 'coral' | 'lavender' | 'cyan' | 'mint' | 'amber' | 'apricot' | 'sage';

export type AccentTarget = 'selected' | 'glow' | 'button' | 'border';

export type AccentHexByTarget = {
  selected: string;
  glow: string;
  button: string;
  border: string;
};

export interface ThemeConfig {
  mode: ThemeMode;
  /** Legacy base palette selection (used for initial values + UI presets). */
  accentColor: AccentColor;
  /** Per-target overrides (hex strings like #7c3aed). */
  accentHex: AccentHexByTarget;
  contrastBoost: boolean;
  /**
   * User-facing motion preference (UI audit 5.5). A shared wall's OS says
   * nothing about motion, so the family can set it here; it mirrors
   * `prefers-reduced-motion` app-wide via `<html data-reduce-motion="true">`.
   */
  reduceMotion: boolean;
}

export const defaultAccentHex: AccentHexByTarget = {
  selected: '#3b82f6',
  glow: 'rgba(59,130,246,0.25)',
  button: '#2563eb',
  border: 'rgba(59,130,246,0.35)',
};

// Default theme configuration
export const defaultThemeConfig: ThemeConfig = {
  mode: 'system',
  accentColor: 'nori',
  accentHex: defaultAccentHex,
  contrastBoost: false,
  reduceMotion: false,
};

// Storage key for theme configuration
export const THEME_STORAGE_KEY = 'home-ai-theme-config';
