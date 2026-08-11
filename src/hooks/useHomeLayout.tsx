/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo, type ReactNode } from "react";
import {
  type WidgetId,
  type WidgetDef,
  type LayoutMode,
  type HomeLayoutConfig,
  cloneDefaultLayout,
  loadLayoutConfig,
  saveLayoutConfig,
  moveWidgetUp,
  moveWidgetDown,
  moveWidgetTo,
  toggleWidget,
  getVisibleWidgets,
  getHiddenWidgets,
} from "@/lib/layout-config";
import { useOrientation } from "@/hooks/useOrientation";

interface LayoutContextValue {
  /** Full config for both orientations. */
  config: HomeLayoutConfig;
  /** Live layout-mode bucket (phone/tablet/desktop). */
  orientation: LayoutMode;
  /** Ordered visible widget ids for the LIVE orientation (what Home renders). */
  widgets: WidgetId[];
  visibleWidgets: WidgetDef[];
  hiddenWidgets: WidgetDef[];
  mounted: boolean;
  /** Mutators for the LIVE orientation. */
  moveUp: (id: WidgetId) => void;
  moveDown: (id: WidgetId) => void;
  reorder: (id: WidgetId, targetIndex: number) => void;
  toggle: (id: WidgetId) => void;
  isVisible: (id: WidgetId) => boolean;
  getIndex: (id: WidgetId) => number;
  /** Read/mutate a SPECIFIC orientation (used by the Settings editor). */
  widgetsFor: (o: LayoutMode) => WidgetId[];
  visibleWidgetsFor: (o: LayoutMode) => WidgetDef[];
  hiddenWidgetsFor: (o: LayoutMode) => WidgetDef[];
  moveUpFor: (o: LayoutMode, id: WidgetId) => void;
  moveDownFor: (o: LayoutMode, id: WidgetId) => void;
  reorderFor: (o: LayoutMode, id: WidgetId, targetIndex: number) => void;
  toggleFor: (o: LayoutMode, id: WidgetId) => void;
  resetLayout: () => void;
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
  const [config, setConfig] = useState<HomeLayoutConfig>(() => cloneDefaultLayout());
  const [suppressRehydrate, setSuppressRehydrate] = useState(false);
  const { orientation } = useOrientation();
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

  const moveUp = useCallback(
    (id: WidgetId) => {
      setConfig((prev) => ({ ...prev, [orientation]: { widgets: moveWidgetUp(prev[orientation].widgets, id) } }));
    },
    [orientation]
  );

  const moveDown = useCallback(
    (id: WidgetId) => {
      setConfig((prev) => ({ ...prev, [orientation]: { widgets: moveWidgetDown(prev[orientation].widgets, id) } }));
    },
    [orientation]
  );

  const reorder = useCallback(
    (id: WidgetId, targetIndex: number) => {
      setConfig((prev) => ({ ...prev, [orientation]: { widgets: moveWidgetTo(prev[orientation].widgets, id, targetIndex) } }));
    },
    [orientation]
  );

  const toggle = useCallback(
    (id: WidgetId) => {
      setConfig((prev) => ({ ...prev, [orientation]: { widgets: toggleWidget(prev[orientation].widgets, id) } }));
    },
    [orientation]
  );

  const moveUpFor = useCallback((o: LayoutMode, id: WidgetId) => {
    setConfig((prev) => ({ ...prev, [o]: { widgets: moveWidgetUp(prev[o].widgets, id) } }));
  }, []);

  const moveDownFor = useCallback((o: LayoutMode, id: WidgetId) => {
    setConfig((prev) => ({ ...prev, [o]: { widgets: moveWidgetDown(prev[o].widgets, id) } }));
  }, []);

  const reorderFor = useCallback((o: LayoutMode, id: WidgetId, targetIndex: number) => {
    setConfig((prev) => ({ ...prev, [o]: { widgets: moveWidgetTo(prev[o].widgets, id, targetIndex) } }));
  }, []);

  const toggleFor = useCallback((o: LayoutMode, id: WidgetId) => {
    setConfig((prev) => ({ ...prev, [o]: { widgets: toggleWidget(prev[o].widgets, id) } }));
  }, []);

  const resetLayout = useCallback(() => {
    if (typeof window === "undefined") return;
    localStorage.removeItem("consuela-home-layout");
    setConfig(cloneDefaultLayout());
  }, []);

  const isVisible = useCallback(
    (id: WidgetId) => config[orientation].widgets.includes(id),
    [config, orientation]
  );

  const getIndex = useCallback(
    (id: WidgetId) => config[orientation].widgets.indexOf(id),
    [config, orientation]
  );

  const widgetsFor = useCallback(
    (o: LayoutMode) => config[o].widgets,
    [config]
  );

  const visibleWidgetsFor = useCallback(
    (o: LayoutMode) => getVisibleWidgets(config[o].widgets),
    [config]
  );

  const hiddenWidgetsFor = useCallback(
    (o: LayoutMode) => getHiddenWidgets(config[o].widgets),
    [config]
  );

  const widgets = config[orientation].widgets;
  const visibleWidgets = useMemo(() => getVisibleWidgets(widgets), [widgets]);
  const hiddenWidgets = useMemo(() => getHiddenWidgets(widgets), [widgets]);

  return (
    <LayoutContext.Provider
      value={{
        config,
        orientation,
        widgets,
        visibleWidgets,
        hiddenWidgets,
        mounted,
        moveUp,
        moveDown,
        reorder,
        toggle,
        isVisible,
        getIndex,
        widgetsFor,
        visibleWidgetsFor,
        hiddenWidgetsFor,
        moveUpFor,
        moveDownFor,
        reorderFor,
        toggleFor,
        resetLayout,
        setSuppressRehydrate,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}
