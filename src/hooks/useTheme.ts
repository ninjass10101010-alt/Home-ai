'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { ThemeMode, AccentColor, ThemeConfig } from '@/lib/theme-config';

interface ThemeContextType extends ThemeConfig {
  isDark: boolean;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
  setContrastBoost: (boost: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const DEFAULT_CONFIG: ThemeConfig = {
  mode: 'system',
  accentColor: 'nori',
  contrastBoost: false,
};

const STORAGE_KEY = 'home-ai-theme-config';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ThemeConfig>(DEFAULT_CONFIG);
  const [isDark, setIsDark] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setConfig(parsed);
      } catch (e) {
        console.warn('Failed to parse stored theme config:', e);
      }
    }
    setIsHydrated(true);
  }, []);

  // Sync isDark based on mode preference
  useEffect(() => {
    const updateTheme = () => {
      let shouldBeDark = false;

      if (config.mode === 'system') {
        shouldBeDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      } else {
        shouldBeDark = config.mode === 'dark';
      }

      setIsDark(shouldBeDark);

      // Apply to document root
      if (shouldBeDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }

      if (config.contrastBoost) {
        document.documentElement.setAttribute('data-contrast', 'boost');
      } else {
        document.documentElement.removeAttribute('data-contrast');
      }
    };

    updateTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', updateTheme);

    return () => mediaQuery.removeEventListener('change', updateTheme);
  }, [config]);

  // Persist config to localStorage
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  }, [config, isHydrated]);

  const toggleTheme = () => {
    setConfig(prev => ({
      ...prev,
      mode: prev.mode === 'dark' ? 'light' : 'dark',
    }));
  };

  const setMode = (mode: ThemeMode) => {
    setConfig(prev => ({ ...prev, mode }));
  };

  const setAccentColor = (color: AccentColor) => {
    setConfig(prev => ({ ...prev, accentColor: color }));
  };

  const setContrastBoost = (boost: boolean) => {
    setConfig(prev => ({ ...prev, contrastBoost: boost }));
  };

  if (!isHydrated) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider
      value={{
        ...config,
        isDark,
        toggleTheme,
        setMode,
        setAccentColor,
        setContrastBoost,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
