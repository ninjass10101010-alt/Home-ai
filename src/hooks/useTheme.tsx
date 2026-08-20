/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';

import { ThemeConfig, ThemeMode, AccentColor, defaultThemeConfig, THEME_STORAGE_KEY, defaultAccentHex, type AccentHexByTarget, type AccentTarget } from '@/lib/theme-config';



// Create the Theme Context
const ThemeContext = createContext<{
  theme: ThemeConfig;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
  setContrastBoost: (boost: boolean) => void;
  setAccentHex: (target: AccentTarget, value: string) => void;
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
          ['nori', 'violet', 'rose', 'coral', 'lavender', 'cyan', 'mint', 'amber', 'apricot', 'sage'].includes(parsed.accentColor) &&
          typeof parsed.contrastBoost === 'boolean' &&
          (!parsed.accentHex || typeof parsed.accentHex === 'object')
        ) {
          setTheme({
            ...defaultThemeConfig,
            ...parsed,
            accentHex: {
              ...defaultAccentHex,
              ...(parsed.accentHex as Partial<AccentHexByTarget>),
            },
          });
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
      let isDark = false;

    // When Time-of-day is "day"/"night" we let it override system.
    const tod = (typeof window !== 'undefined' && (window as any).__consuelaTod) as 'day' | 'night' | undefined;

    if (theme.mode === 'dark') {
      isDark = true;
    } else if (theme.mode === 'light') {
      isDark = false;
    } else if (theme.mode === 'system') {
      if (tod === 'day') isDark = false;
      else if (tod === 'night') isDark = true;
      else {
        // fallback — same clock as WeatherProvider/Atmosphere (6am-7pm day).
        const hour = new Date().getHours();
        isDark = hour < 6 || hour >= 19;
      }
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

      // Update CSS variables (per-target overrides)
      document.documentElement.style.setProperty('--color-accent-selected', theme.accentHex.selected);
      document.documentElement.style.setProperty('--color-accent-glow', theme.accentHex.glow);
      document.documentElement.style.setProperty('--color-accent-button', theme.accentHex.button);
      document.documentElement.style.setProperty('--color-accent-border', theme.accentHex.border);
      document.documentElement.style.setProperty('--color-text-on-accent', '#ffffff');

    };

    updateHtmlAttributes();

    // Re-check every 15 minutes for day/night transition
    const interval = setInterval(updateHtmlAttributes, 15 * 60 * 1000);

    // Also listen for system preference changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => updateHtmlAttributes();
    mediaQuery.addEventListener('change', handleChange);

    // Re-run immediately when WeatherProvider flips __consuelaTod (e.g. user
    // changes Time-of-day or the 6am/7pm boundary is crossed while the page
    // is open). Without this, ThemeProvider would stay stale for up to 15m.
    const handleTodChange = () => updateHtmlAttributes();
    window.addEventListener('consuela-tod-change', handleTodChange as EventListener);
    window.addEventListener('storage', handleTodChange);

    return () => {
      clearInterval(interval);
      mediaQuery.removeEventListener('change', handleChange);
      window.removeEventListener('consuela-tod-change', handleTodChange as EventListener);
      window.removeEventListener('storage', handleTodChange);
    }
  }, [
    theme.mode,
    theme.contrastBoost,
    theme.accentHex.selected,
    theme.accentHex.glow,
    theme.accentHex.button,
    theme.accentHex.border,
    mounted,
  ]);



  // Function to toggle between light and dark (ignores system mode for toggle)
  const setAccentHex = useCallback((target: AccentTarget, value: string) => {
    setTheme((prev) => ({
      ...prev,
      accentHex: {
        ...prev.accentHex,
        [target]: value,
      },
    }));
  }, []);

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
    <ThemeContext.Provider value={{ theme, toggleTheme, setMode, setAccentColor, setContrastBoost, setAccentHex }}>
      {children}

    </ThemeContext.Provider>
  );
};