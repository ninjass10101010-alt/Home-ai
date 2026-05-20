export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentColor = 'nori' | 'violet' | 'rose' | 'cyan' | 'mint' | 'amber';

export interface ThemeConfig {
  mode: ThemeMode;
  accentColor: AccentColor;
  contrastBoost: boolean;
}

export const ACCENT_COLORS: Record<AccentColor, { light: string; dark: string; name: string }> = {
  nori: { light: '#2563eb', dark: '#60a5fa', name: 'Nori Blue' },
  violet: { light: '#7c3aed', dark: '#a78bfa', name: 'Violet' },
  rose: { light: '#e11d48', dark: '#fb7185', name: 'Rose' },
  cyan: { light: '#0891b2', dark: '#06b6d4', name: 'Cyan' },
  mint: { light: '#059669', dark: '#4ade80', name: 'Mint' },
  amber: { light: '#d97706', dark: '#fbbf24', name: 'Amber' },
};

export const LIGHT_MODE_COLORS = {
  // Backgrounds
  surface: {
    0: '#FFFFFF',
    1: '#F8F9FB',
    2: '#F0F2F7',
    3: '#E7EBF3',
    4: '#DDE3ED',
    5: '#D3DAE7',
  },
  // Text
  text: {
    primary: '#1A1A1A',
    secondary: '#5A5A5A',
    muted: '#8A8A8A',
    dim: '#ABABAB',
  },
  // Accents
  accent: {
    violet: '#7c3aed',
    amber: '#d97706',
    rose: '#e11d48',
    cyan: '#0891b2',
    lavender: '#b583ff',
    coral: '#ff6b8a',
    mint: '#059669',
    pink: '#ec4899',
    sky: '#0ea5e9',
    teal: '#14b8a6',
  },
  // Utility
  border: 'rgba(0, 0, 0, 0.06)',
  shadow: 'rgba(0, 0, 0, 0.08)',
};

export const DARK_MODE_COLORS = {
  // Backgrounds
  surface: {
    0: '#0f1117',
    1: '#181c24',
    2: '#1e2330',
    3: '#252c3a',
    4: '#2d3548',
    5: '#323b4d',
  },
  // Text
  text: {
    primary: '#f0f4ff',
    secondary: '#8892aa',
    muted: '#4e5a72',
    dim: '#363e50',
  },
  // Accents
  accent: {
    violet: '#a78bfa',
    amber: '#fbbf24',
    rose: '#fb7185',
    cyan: '#06b6d4',
    lavender: '#b583ff',
    coral: '#ff6b8a',
    mint: '#4ade80',
    pink: '#f472b6',
    sky: '#38bdf8',
    teal: '#2dd4bf',
  },
  // Utility
  border: 'rgba(255, 255, 255, 0.08)',
  shadow: 'rgba(0, 0, 0, 0.16)',
};

export const getThemeColors = (isDark: boolean) =>
  isDark ? DARK_MODE_COLORS : LIGHT_MODE_COLORS;
