// Type definitions for the theme system
export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentColor = 'nori' | 'violet' | 'rose' | 'coral' | 'lavender' | 'cyan' | 'mint' | 'amber';

export interface ThemeConfig {
  mode: ThemeMode;
  accentColor: AccentColor;
  contrastBoost: boolean;
}

// Default theme configuration
export const defaultThemeConfig: ThemeConfig = {
  mode: 'system',
  accentColor: 'nori',
  contrastBoost: false,
};

// Storage key for theme configuration
export const THEME_STORAGE_KEY = 'home-ai-theme-config';
