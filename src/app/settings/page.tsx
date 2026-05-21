"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/hooks/useTheme";
import PageShell from "@/components/ui/PageShell";
import TopBar from "@/components/ui/TopBar";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { Moon, Sun } from "lucide-react";

export default function SettingsPage() {
  const { theme, setMode, setAccentColor, setContrastBoost } = useTheme();
  
  // State for UI interactions
  const [mode, setModeState] = useState(theme.mode);
  const [accentColor, setAccentColorState] = useState(theme.accentColor);
  const [contrastBoost, setContrastBoostState] = useState(theme.contrastBoost);
  
  // Sync state with theme hook when it changes externally
  useEffect(() => {
    setModeState(theme.mode);
    setAccentColorState(theme.accentColor);
    setContrastBoostState(theme.contrastBoost);
  }, [theme.mode, theme.accentColor, theme.contrastBoost]);
  
  // Update theme when state changes
  useEffect(() => {
    setMode(mode);
    setAccentColor(accentColor);
    setContrastBoost(contrastBoost);
  }, [mode, accentColor, contrastBoost, setMode, setAccentColor, setContrastBoost]);
  
  // Accent color options
  const accentOptions = [
    { id: 'nori', label: 'Nori', dark: '#3b82f6', light: '#2563eb' },
    { id: 'violet', label: 'Violet', dark: '#7c6ff7', light: '#7c3aed' },
    { id: 'rose', label: 'Rose', dark: '#f43f5e', light: '#e11d48' },
    { id: 'cyan', label: 'Cyan', dark: '#06b6d4', light: '#0891b2' },
    { id: 'mint', label: 'Mint', dark: '#4ade80', light: '#059669' },
    { id: 'amber', label: 'Amber', dark: '#f59e0b', light: '#d97706' },
  ] as const;
  
  // Determine current accent color values based on mode
  const getAccentColor = (option: typeof accentOptions[number]) => {
    const isDark = mode === 'dark' || (mode === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return isDark ? option.dark : option.light;
  };

  return (
    <PageShell>
      <TopBar title="Settings" subtitle="Customize your Consuela experience" />
      
      <div className="px-4 py-6 space-y-8">
        {/* Theme & Appearance Section */}
        <section className="space-y-6">
          <h2 className="text-text-primary font-semibold text-2xl">Theme & Appearance</h2>
          <p className="text-text-secondary">Customize how Consuela looks to you</p>
          
          {/* Display Mode */}
          <div className="space-y-4">
            <h3 className="text-text-primary font-semibold">Display Mode</h3>
            <p className="text-text-secondary">Choose how the app appears</p>
            
            <div className="space-y-3">
              {/* Light Mode Option */}
              <label className="flex items-center cursor-pointer rounded-xl border border-[var(--color-surface-3)] p-4 hover:border-[var(--color-accent-selected)]/50 hover:bg-[var(--color-accent-selected)]/5 transition-[border-color,background-color] duration-200">
                <input
                  type="radio"
                  name="displayMode"
                  checked={mode === 'light'}
                  onChange={() => setModeState('light')}
                  className="sr-only"
                />
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-text-primary font-semibold">Light Mode</p>
                    <p className="text-text-secondary text-xs">Best for daytime and bright spaces</p>
                  </div>
                  {/* Radio Circle */}
                  <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center">
                    <div className={`h-4 w-4 rounded-full bg-[var(--color-accent-selected)] opacity-0 transition-opacity duration-200 ${mode === 'light' ? 'opacity-100' : ''}`}></div>
                  </div>
                </div>
              </label>
              
              {/* System Mode Option */}
              <label className="flex items-center cursor-pointer rounded-xl border border-[var(--color-surface-3)] p-4 hover:border-[var(--color-accent-selected)]/50 hover:bg-[var(--color-accent-selected)]/5 transition-[border-color,background-color] duration-200">
                <input
                  type="radio"
                  name="displayMode"
                  checked={mode === 'system'}
                  onChange={() => setModeState('system')}
                  className="sr-only"
                />
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-text-primary font-semibold">System (Default)</p>
                    <p className="text-text-secondary text-xs">Follows your device settings</p>
                  </div>
                  {/* Radio Circle */}
                  <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center">
                    <div className={`h-4 w-4 rounded-full bg-[var(--color-accent-selected)] opacity-0 transition-opacity duration-200 ${mode === 'system' ? 'opacity-100' : ''}`}></div>
                  </div>
                </div>
              </label>
              
              {/* Dark Mode Option */}
              <label className="flex items-center cursor-pointer rounded-xl border border-[var(--color-surface-3)] p-4 hover:border-[var(--color-accent-selected)]/50 hover:bg-[var(--color-accent-selected)]/5 transition-[border-color,background-color] duration-200">
                <input
                  type="radio"
                  name="displayMode"
                  checked={mode === 'dark'}
                  onChange={() => setModeState('dark')}
                  className="sr-only"
                />
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-text-primary font-semibold">Dark Mode</p>
                    <p className="text-text-secondary text-xs">Best for evening and low-light</p>
                  </div>
                  {/* Radio Circle */}
                  <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center">
                    <div className={`h-4 w-4 rounded-full bg-[var(--color-accent-selected)] opacity-0 transition-opacity duration-200 ${mode === 'dark' ? 'opacity-100' : ''}`}></div>
                  </div>
                </div>
              </label>
            </div>
          </div>
          
          {/* Accent Color */}
          <div className="space-y-4">
            <h3 className="text-text-primary font-semibold">Accent Color</h3>
            <p className="text-text-secondary">Choose your primary highlight color</p>
            
            <div className="flex flex-wrap gap-3">
              {accentOptions.map(option => (
                <label key={option.id} className="flex items-center cursor-pointer gap-2">
                  <input
                    type="radio"
                    name="accentColor"
                    checked={accentColor === option.id}
                    onChange={() => setAccentColorState(option.id)}
                    className="sr-only"
                  />
                  <div className="flex flex-col items-center">
                    <div 
                      className={`w-10 h-10 rounded-xl transition-[background-color,transform,border-color] duration-200 border-2 ${
                        accentColor === option.id 
                          ? 'border-[var(--color-accent-selected)] scale-105' 
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ 
                        backgroundColor: `var(--color-accent-${option.id})`,
                        boxShadow: accentColor === option.id ? `0 0 12px var(--color-accent-${option.id})` : 'none'
                      }}
                    />
                    <p className="text-xs text-text-secondary mt-1 capitalize">{option.label}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          
          {/* Preview Card */}
          <div className="space-y-4">
            <h3 className="text-text-primary font-semibold">Preview</h3>
            <p className="text-text-secondary">Your Consuela will look like:</p>
            
            <Card className="aspect-[3/2]">
              <div className="p-6 space-y-4">
                <p className="text-text-primary">This text uses your current colors</p>
                <p className="text-text-muted">Background: Your selected theme</p>
                <Button variant="primary" className="w-fit">
                  Accent Color Button
                </Button>
                <p className="text-text-xs text-text-muted mt-2">Changes apply instantly (no reload)</p>
              </div>
            </Card>
          </div>
          
          {/* High Contrast Mode */}
          <div className="space-y-4">
            <h3 className="text-text-primary font-semibold">High Contrast Mode</h3>
            <p className="text-text-secondary">Improve readability with stronger contrasts</p>
            
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={contrastBoost}
                onChange={(e) => setContrastBoostState(e.target.checked)}
                className="
                  h-4 w-4 rounded border-[var(--color-surface-3)] 
                  bg-[var(--color-surface-0)] 
                  checked:bg-[var(--color-accent-selected)] 
                  checked:border-[var(--color-accent-selected)]
                  transition-all duration-200
                  focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-[var(--color-accent-selected)] focus-visible:ring-offset-2
                "
              />
              <span className="ml-3 text-text-primary">Enable high contrast mode</span>
            </label>
          </div>
        </section>
      </div>
    </PageShell>
  );
}