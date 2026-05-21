import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { ThemeConfig, ThemeMode, AccentColor, defaultThemeConfig, THEME_STORAGE_KEY } from '@/lib/theme-config';

// Create the Theme Context
const ThemeContext = createContext<{
  theme: ThemeConfig;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
  setContrastBoost: (boost: boolean) => void;
} | undefined>(undefined);

// Custom hook to use the theme
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Theme Provider component
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // Initialize theme state from localStorage or defaults
  const [theme, setTheme] = useState<ThemeConfig>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Validate the parsed object has the required properties
        if (
          parsed.mode &&
          ['light', 'dark', 'system'].includes(parsed.mode) &&
          parsed.accentColor &&
          ['nori', 'violet', 'rose', 'cyan', 'mint', 'amber'].includes(parsed.accentColor) &&
          typeof parsed.contrastBoost === 'boolean'
        ) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse theme config from localStorage', e);
      }
    }
    return defaultThemeConfig;
  });

  // Effect to handle system mode and update html attributes
  useEffect(() => {
    const updateHtmlAttributes = () => {
      // Determine if we should be in dark mode based on theme mode and system preference
      let isDark = false;
      if (theme.mode === 'dark') {
        isDark = true;
      } else if (theme.mode === 'light') {
        isDark = false;
      } else if (theme.mode === 'system') {
        // Check system preference
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      // Set data-theme attribute on html element
      if (isDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }

      // Set data-contrast attribute for high contrast mode
      if (theme.contrastBoost) {
        document.documentElement.setAttribute('data-contrast', 'boost');
      } else {
        document.documentElement.removeAttribute('data-contrast');
      }

      // Update CSS variables for accent selected and text on accent
      document.documentElement.style.setProperty('--color-accent-selected', `var(--color-accent-${theme.accentColor})`);
      document.documentElement.style.setProperty('--color-text-on-accent', '#ffffff');
    };

    // Run on initial render and whenever theme changes
    updateHtmlAttributes();

    // Create a media listener for system mode changes
    if (theme.mode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => updateHtmlAttributes();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme.mode, theme.accentColor, theme.contrastBoost]);

  // Effect to save theme to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  // Function to toggle between light and dark (ignores system mode for toggle)
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      if (prev.mode === 'system') {
        // If in system mode, toggle based on current system preference
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        return { ...prev, mode: isSystemDark ? 'light' : 'dark' };
      }
      return {
        ...prev,
        mode: prev.mode === 'light' ? 'dark' : 'light',
      };
    });
  }, []);

  // Function to set the mode
  const setMode = useCallback((mode: ThemeMode) => {
    setTheme((prev) => ({ ...prev, mode }));
  }, []);

  // Function to set the accent color
  const setAccentColor = useCallback((color: AccentColor) => {
    setTheme((prev) => ({ ...prev, accentColor: color }));
  }, []);

  // Function to set contrast boost
  const setContrastBoost = useCallback((boost: boolean) => {
    setTheme((prev) => ({ ...prev, contrastBoost: boost }));
  }, []);

  return {
    theme,
    toggleTheme,
    setMode,
    setAccentColor,
    setContrastBoost,
  };
};