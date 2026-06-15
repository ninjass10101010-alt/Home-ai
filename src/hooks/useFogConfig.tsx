/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";

export interface FogConfig {
  enabled: boolean;
  highlightColor: string;
  lowlightColor: string;
  speed: number;
  blurFactor: number;
}

const FOG_STORAGE_KEY = "home-ai-fog-config";

export const defaultFogConfig: FogConfig = {
  enabled: true,
  highlightColor: "#c8a86a",
  lowlightColor: "#4a5a8e",
  speed: 0.5,
  blurFactor: 0.35,
};

type FogContextValue = {
  config: FogConfig;
  setEnabled: (v: boolean) => void;
  setHighlightColor: (v: string) => void;
  setLowlightColor: (v: string) => void;
  setSpeed: (v: number) => void;
  setBlurFactor: (v: number) => void;
  resetConfig: () => void;
};

const FogContext = createContext<FogContextValue | null>(null);

export function FogProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<FogConfig>(defaultFogConfig);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(FOG_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setConfig((prev) => ({ ...prev, ...parsed }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(FOG_STORAGE_KEY, JSON.stringify(config));
    } catch {}
  }, [config, mounted]);

  const setEnabled = useCallback(
    (v: boolean) => setConfig((p) => ({ ...p, enabled: v })),
    [],
  );
  const setHighlightColor = useCallback(
    (v: string) => setConfig((p) => ({ ...p, highlightColor: v })),
    [],
  );
  const setLowlightColor = useCallback(
    (v: string) => setConfig((p) => ({ ...p, lowlightColor: v })),
    [],
  );
  const setSpeed = useCallback(
    (v: number) => setConfig((p) => ({ ...p, speed: v })),
    [],
  );
  const setBlurFactor = useCallback(
    (v: number) => setConfig((p) => ({ ...p, blurFactor: v })),
    [],
  );
  const resetConfig = useCallback(() => setConfig(defaultFogConfig), []);

  return (
    <FogContext.Provider
      value={{
        config,
        setEnabled,
        setHighlightColor,
        setLowlightColor,
        setSpeed,
        setBlurFactor,
        resetConfig,
      }}
    >
      {children}
    </FogContext.Provider>
  );
}

export function useFogConfig(): FogContextValue {
  const ctx = useContext(FogContext);
  if (!ctx)
    throw new Error("useFogConfig must be used within FogProvider");
  return ctx;
}