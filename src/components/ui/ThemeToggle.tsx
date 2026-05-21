import { useTheme } from '@/hooks/useTheme';

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme.mode === 'dark' || (theme.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="
        flex items-center justify-center w-10 h-10
        bg-[var(--color-surface-2)] 
        rounded-full
        transition-all duration-200
        hover:bg-[var(--color-surface-3)]
        focus-visible:outline-none
        focus-visible:ring-2 focus-visible:ring-[var(--color-accent-nori)] focus-visible:ring-offset-2
        data-[state=active]:scale-[0.95]
      "
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
};