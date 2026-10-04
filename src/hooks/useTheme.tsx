/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';

import { ThemeConfig, ThemeMode, AccentColor, defaultThemeConfig, THEME_STORAGE_KEY, defaultAccentHex, type AccentHexByTarget, type AccentTarget } from '@/lib/theme-config';
import { warmGlassAccentOptions } from '@/lib/design-tokens';

// The Accent Studio (settings/Appearance) writes a preset's own hex for every
// target. Those hexes are the DARK palette — globals.css carries a second,
// darker set per theme — so writing them inline on <html> outranked
// `:root[data-theme="light"]` and pinned the light theme to the dark accent.
//
// The provider therefore publishes the accent IDENTITY as `data-accent` and
// lets the stylesheet resolve `--color-accent-<id>` per theme. An inline style
// is only written when the family has genuinely hand-picked a colour for a
// target, which has no per-theme counterpart to defer to.
const presetHexFor = (id: AccentColor, target: AccentTarget): string | undefined => {
  const accent = warmGlassAccentOptions.find((option) => option.id === id);
  if (!accent) return undefined;
  return target === 'glow' || target === 'border' ? accent.glow : accent.hex;
};

/** True when the stored target still holds its untouched preset value. */
const isPresetValue = (id: AccentColor, target: AccentTarget, value: string): boolean => {
  const preset = presetHexFor(id, target);
  if (preset === undefined) return false;
  return preset.trim().toLowerCase() === value.trim().toLowerCase();
};

/** "#7c3aed" -> "124, 58, 237" — the channel-triple form legacy call sites read. */
function hexToRgbChannels(value: string): string | null {
  const hex = value.trim().replace(/^#/, '').toLowerCase();
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/.test(full)) return null;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)).join(', ');
}



// Create the Theme Context
const ThemeContext = createContext<{
  theme: ThemeConfig;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
  setContrastBoost: (boost: boolean) => void;
  setReduceMotion: (value: boolean) => void;
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
          (parsed.reduceMotion === undefined || typeof parsed.reduceMotion === 'boolean') &&
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

    let resolvedTod: 'day' | 'night';
    if (tod === 'day' || tod === 'night') {
      resolvedTod = tod;
    } else {
      // fallback — same clock as WeatherProvider/Atmosphere (6am-7pm day).
      const hour = new Date().getHours();
      resolvedTod = hour >= 6 && hour < 19 ? 'day' : 'night';
    }

    // Publish the answer to "is it night outside?" for the atmosphere layer.
    // WeatherProvider resolves that clock into `__consuelaTod` and ThemeProvider
    // is where it is applied to the document, so this is the one write that
    // makes it readable from `<html>`. It is written as a DEFAULT: an existing
    // value is an explicit pin (the visual-review harness forces a clock state
    // with it) and is left alone.
    if (!document.documentElement.hasAttribute('data-timeofday')) {
      document.documentElement.setAttribute('data-timeofday', resolvedTod);
    }

    if (theme.mode === 'dark') {
      isDark = true;
    } else if (theme.mode === 'light') {
      isDark = false;
    } else if (theme.mode === 'system') {
      isDark = resolvedTod === 'night';
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

      // User-facing Reduce motion (UI audit 5.5): the same effect as the OS
      // prefers-reduced-motion rules, but set by the family — a shared wall's
      // OS preference says nothing about motion. Motion-aware components
      // (AnimatedEmoji, usePrefersReducedMotion) listen for the dispatched
      // event so an in-session toggle takes effect immediately.
      if (theme.reduceMotion) {
        document.documentElement.setAttribute('data-reduce-motion', 'true');
      } else {
        document.documentElement.removeAttribute('data-reduce-motion');
      }
      window.dispatchEvent(new Event('consuela-motion-preference-change'));

      // Publish the accent IDENTITY (not a colour) so the stylesheet can pick
      // the active theme's `--color-accent-<id>`.
      document.documentElement.setAttribute('data-accent', theme.accentColor);

      // Per-target overrides. A target still holding its preset value is
      // removed from the inline layer so globals.css's per-theme derivation
      // takes over; only a hand-picked colour stays inline.
      const overrides: Record<AccentTarget, string> = {
        selected: theme.accentHex.selected,
        glow: theme.accentHex.glow,
        button: theme.accentHex.button,
        border: theme.accentHex.border,
      };
      for (const target of ['selected', 'glow', 'button', 'border'] as AccentTarget[]) {
        const property = `--color-accent-${target}`;
        const value = overrides[target];
        if (isPresetValue(theme.accentColor, target, value)) {
          document.documentElement.style.removeProperty(property);
          continue;
        }
        document.documentElement.style.setProperty(property, value);
      }

      // The rgb triple behind the three
      // The channel triple for the three legacy alpha call sites that read
      // `--color-accent-selected-rgb` (PhotoMemoriesWidget, HomeAssistantWidget
      // ×2), which silently fell back to a hardcoded nori blue while the token
      // was assigned nowhere. For a preset accent the
      // stylesheet owns it per accent × theme, so publishing the stored dark
      // hex here is exactly the hardcoded-nori-blue bug this replaced; for a
      // hand-picked accent there is no themed pair, so it follows the custom
      // hex. Either way it must never be left undefined.
      const channels = hexToRgbChannels(overrides.selected);
      if (channels === null || isPresetValue(theme.accentColor, 'selected', overrides.selected)) {
        document.documentElement.style.removeProperty('--color-accent-selected-rgb');
      } else {
        document.documentElement.style.setProperty('--color-accent-selected-rgb', channels);
      }

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
    theme.reduceMotion,
    theme.accentColor,
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

  // Function to set the user-facing motion preference (UI audit 5.5)
  const setReduceMotion = useCallback((value: boolean) => {
    setTheme((prev) => ({ ...prev, reduceMotion: value }));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setMode, setAccentColor, setContrastBoost, setReduceMotion, setAccentHex }}>
      {children}

    </ThemeContext.Provider>
  );
};