/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo, type ReactNode } from "react";
import {
  WidgetId,
  WidgetDef,
  HomeLayoutConfig,
  DEFAULT_LAYOUT,
  loadLayoutConfig,
  saveLayoutConfig,
  moveWidgetUp,
  moveWidgetDown,
  moveWidgetTo,
  toggleWidget,
  getVisibleWidgets,
  getHiddenWidgets,
} from "@/lib/layout-config";

interface LayoutContextValue {
  config: HomeLayoutConfig;
  widgets: WidgetId[];
  visibleWidgets: WidgetDef[];
  hiddenWidgets: WidgetDef[];
  mounted: boolean;
  moveUp: (id: WidgetId) => void;
  moveDown: (id: WidgetId) => void;
  reorder: (id: WidgetId, targetIndex: number) => void;
  toggle: (id: WidgetId) => void;
  isVisible: (id: WidgetId) => boolean;
  getIndex: (id: WidgetId) => number;
  /** Suppress focus/visibilitychange rehydration (used by Settings editor). */
  setSuppressRehydrate: (value: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue | undefined>(undefined);

export const useHomeLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error("useHomeLayout must be used within a LayoutProvider");
  }
  return context;
};

const SAVE_DEBOUNCE_MS = 250;

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<HomeLayoutConfig>(() => ({
    ...DEFAULT_LAYOUT,
    widgets: [...DEFAULT_LAYOUT.widgets],
  }));
  const [suppressRehydrate, setSuppressRehydrate] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setMounted(true);
    setConfig(loadLayoutConfig());
  }, []);

  // Persist on every change (after mount), debounced to avoid thrash on rapid clicks.
  useEffect(() => {
    if (!mounted) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveLayoutConfig(config);
      saveTimer.current = null;
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [config, mounted]);

  // Flush any pending save before unload so a quick tab close doesn't drop the latest move.
  useEffect(() => {
    if (!mounted) return;
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        saveLayoutConfig(config);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [config, mounted]);

  // Re-read from localStorage when the window regains focus or becomes visible,
  // unless the consumer (e.g. Settings editor) has suppressed rehydration.
  useEffect(() => {
    if (!mounted || suppressRehydrate) return;
    const handleRehydrate = () => {
      setConfig(loadLayoutConfig());
    };
    window.addEventListener("focus", handleRehydrate);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        handleRehydrate();
      }
    });
    return () => {
      window.removeEventListener("focus", handleRehydrate);
      document.removeEventListener("visibilitychange", handleRehydrate);
    };
  }, [mounted, suppressRehydrate]);

  const moveUp = useCallback((id: WidgetId) => {
    setConfig((prev) => ({ widgets: moveWidgetUp(prev.widgets, id) }));
  }, []);

  const moveDown = useCallback((id: WidgetId) => {
    setConfig((prev) => ({ widgets: moveWidgetDown(prev.widgets, id) }));
  }, []);

  const reorder = useCallback((id: WidgetId, targetIndex: number) => {
    setConfig((prev) => ({ widgets: moveWidgetTo(prev.widgets, id, targetIndex) }));
  }, []);

  const toggle = useCallback((id: WidgetId) => {
    setConfig((prev) => ({ widgets: toggleWidget(prev.widgets, id) }));
  }, []);

  const isVisible = useCallback(
    (id: WidgetId) => config.widgets.includes(id),
    [config.widgets]
  );

  const getIndex = useCallback(
    (id: WidgetId) => config.widgets.indexOf(id),
    [config.widgets]
  );

  const visibleWidgets = useMemo(() => getVisibleWidgets(config.widgets), [config.widgets]);
  const hiddenWidgets = useMemo(() => getHiddenWidgets(config.widgets), [config.widgets]);

  return (
    <LayoutContext.Provider
      value={{
        config,
        widgets: config.widgets,
        visibleWidgets,
        hiddenWidgets,
        mounted,
        moveUp,
        moveDown,
        reorder,
        toggle,
        isVisible,
        getIndex,
        setSuppressRehydrate,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}
