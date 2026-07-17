/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useTheme } from '@/hooks/useTheme';
import { useState, useEffect } from 'react';

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Return a placeholder of the same size to avoid layout shift and hydration mismatch
    return (
      <div className="w-10 h-10 rounded-full bg-[var(--color-surface-2)]" />
    );
  }

  const isDark = theme.mode === 'dark' || (theme.mode === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="
        flex items-center justify-center w-10 h-10
        bg-[var(--color-surface-2)] 
        rounded-full
        hover:bg-[var(--color-surface-3)]
        tap-sm
      "
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
};