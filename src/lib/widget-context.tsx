"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { DEFAULT_WIDGET_ORDER, WidgetOrder } from './widget-registry';

interface WidgetContextType {
  order: WidgetOrder;
  setOrder: (newOrder: WidgetOrder) => void;
  reorderWidgets: (fromIndex: number, toIndex: number) => void;
  simulateBotUpdate: (newOrder: WidgetOrder) => void;
  resetToDefault: () => void;
}

const WidgetContext = createContext<WidgetContextType | undefined>(undefined);

const STORAGE_KEY = 'consuela-widget-order';
const PB_SYNC_ENABLED = false; // Set true when PB collection 'widget_orders' exists

export function WidgetProvider({ children }: { children: ReactNode }) {
  const [order, setOrderState] = useState<WidgetOrder>(DEFAULT_WIDGET_ORDER);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setOrderState(parsed);
        }
      } catch {}
    }
  }, []);

  const setOrder = (newOrder: WidgetOrder) => {
    setOrderState(newOrder);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrder));

    // Optional PocketBase sync (future)
    if (PB_SYNC_ENABLED) {
      // e.g. await pb.collection('widget_orders').update('global', { order: newOrder });
    }
  };

  const reorderWidgets = (fromIndex: number, toIndex: number) => {
    const newOrder = [...order];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    setOrder(newOrder);
  };

  const simulateBotUpdate = (newOrder: WidgetOrder) => {
    // Allows external/bot to force reorder
    setOrder(newOrder);
  };

  const resetToDefault = () => {
    setOrder(DEFAULT_WIDGET_ORDER);
  };

  return (
    <WidgetContext.Provider value={{ order, setOrder, reorderWidgets, simulateBotUpdate, resetToDefault }}>
      {children}
    </WidgetContext.Provider>
  );
}

export function useWidgetOrder() {
  const ctx = useContext(WidgetContext);
  if (!ctx) {
    throw new Error('useWidgetOrder must be used within WidgetProvider');
  }
  return ctx;
}
