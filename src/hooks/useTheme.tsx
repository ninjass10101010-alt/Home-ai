'use client';

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
  // Initialize theme state to defaults for SSR/initial client render compatibility
  const [theme, setTheme] = useState<ThemeConfig>(defaultThemeConfig);
  const [mounted, setMounted] = useState(false);

  // Load theme from localStorage after component mounts on the client
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (
          parsed.mode &&
          ['light', 'dark', 'system'].includes(parsed.mode) &&
          parsed.accentColor &&
          ['nori', 'violet', 'rose', 'cyan', 'mint', 'amber'].includes(parsed.accentColor) &&
          typeof parsed.contrastBoost === 'boolean'
        ) {
          setTheme(parsed);
        }
      } catch (e) {
        console.error('Failed to parse theme config from localStorage', e);
      }
    }
  }, []);

  // Save theme to localStorage only after component mounts and theme changes
  useEffect(() => {
    if (mounted) {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    }
  }, [theme, mounted]);

  // Effect to handle system mode and update html attributes (only runs on client after mount)
  useEffect(() => {
    if (!mounted) return;

    const updateHtmlAttributes = () => {
      // Smart auto-detection: use time of day + season for dark/light
      let isDark = false;
      if (theme.mode === 'dark') {
        isDark = true;
      } else if (theme.mode === 'light') {
        isDark = false;
      } else if (theme.mode === 'system') {
        // Smart auto: check actual daylight based on current hour + month
        const now = new Date();
        const hour = now.getHours();
        const month = now.getMonth(); // 0-11

        // Approximate sunrise/sunset by month for northern US (Holland, MI ~42.8°N)
        // Winter (Nov-Feb): dark 5pm-7am, light 7am-5pm
        // Spring/Fall (Mar-Apr, Sep-Oct): dark 7pm-6:30am, light 6:30am-7pm
        // Summer (May-Aug): dark 9pm-6am, light 6am-9pm
        let sunsetHour = 19; // default 7pm
        let sunriseHour = 7; // default 7am

        if (month >= 4 && month <= 7) { // May-Aug
          sunsetHour = 21; sunriseHour = 6;
        } else if (month >= 2 && month <= 3) { // Mar-Apr
          sunsetHour = 19; sunriseHour = 7;
        } else if (month >= 8 && month <= 9) { // Sep-Oct
          sunsetHour = 19; sunriseHour = 7;
        } else { // Nov-Feb
          sunsetHour = 17; sunriseHour = 7;
        }

        isDark = hour >= sunsetHour || hour < sunriseHour;
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

      // Update CSS variables
      document.documentElement.style.setProperty('--color-accent-selected', `var(--color-accent-${theme.accentColor})`);
      document.documentElement.style.setProperty('--color-text-on-accent', '#ffffff');
    };

    updateHtmlAttributes();

    // Re-check every 15 minutes for day/night transition
    const interval = setInterval(updateHtmlAttributes, 15 * 60 * 1000);

    // Also listen for system preference changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => updateHtmlAttributes();
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      clearInterval(interval);
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [theme.mode, theme.accentColor, theme.contrastBoost, mounted]);

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

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setMode, setAccentColor, setContrastBoost }}>
      {children}
    </ThemeContext.Provider>
  );
};