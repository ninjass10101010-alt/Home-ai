"use client";

import { useState, useEffect, useCallback } from "react";
import {
  WidgetId,
  HomeLayoutConfig,
  DEFAULT_LAYOUT,
  loadLayoutConfig,
  saveLayoutConfig,
  moveWidgetUp,
  moveWidgetDown,
  toggleWidget,
} from "@/lib/layout-config";

export function useHomeLayout() {
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<HomeLayoutConfig>(() => ({
    ...DEFAULT_LAYOUT,
    widgets: [...DEFAULT_LAYOUT.widgets],
  }));

  // Hydrate from localStorage on mount
  useEffect(() => {
    setMounted(true);
    setConfig(loadLayoutConfig());
  }, []);

  // Persist on every change (after mount)
  useEffect(() => {
    if (mounted) {
      saveLayoutConfig(config);
    }
  }, [config, mounted]);

  const moveUp = useCallback((id: WidgetId) => {
    setConfig((prev) => ({ widgets: moveWidgetUp(prev.widgets, id) }));
  }, []);

  const moveDown = useCallback((id: WidgetId) => {
    setConfig((prev) => ({ widgets: moveWidgetDown(prev.widgets, id) }));
  }, []);

  const toggle = useCallback((id: WidgetId) => {
    setConfig((prev) => ({ widgets: toggleWidget(prev.widgets, id) }));
  }, []);

  /** Check if a widget is currently visible */
  const isVisible = useCallback(
    (id: WidgetId) => config.widgets.includes(id),
    [config.widgets]
  );

  /** Get widget index in the order (for up/down affordance) */
  const getIndex = useCallback(
    (id: WidgetId) => config.widgets.indexOf(id),
    [config.widgets]
  );

  return {
    config,
    widgets: config.widgets,
    mounted,
    moveUp,
    moveDown,
    toggle,
    isVisible,
    getIndex,
  };
}