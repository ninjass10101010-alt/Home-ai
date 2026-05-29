"use client";

import { useCallback } from "react";

const API_BASE = "http://100.120.64.66:6789";

/**
 * Read data: localStorage cache → API fallback → seed fallback
 */
export function getData<T>(storageKey: string, seedFn?: () => T[]): T[] {
  if (typeof window === "undefined") return seedFn?.() || [];

  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  const seed = seedFn?.() || [];
  // Seed localStorage for next time
  try { localStorage.setItem(storageKey, JSON.stringify(seed)); } catch {}
  return seed;
}

/**
 * Write data: update localStorage, then push to API
 */
export function saveData<T>(apiType: string, storageKey: string, data: T[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {}

  // Fire-and-forget API sync
  fetch(`${API_BASE}/data/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: apiType, data }),
  }).catch(() => {});
}

/**
 * Pull data from API into localStorage (called on mount)
 */
export async function pullFromApi<T>(apiType: string, storageKey: string, seedFn?: () => T[]): Promise<T[]> {
  try {
    const res = await fetch(`${API_BASE}/data/sync?type=${apiType}`);
    const result = await res.json();
    if (result.success && Array.isArray(result.data) && result.data.length > 0) {
      try { localStorage.setItem(storageKey, JSON.stringify(result.data)); } catch {}
      return result.data;
    }
  } catch {}

  return getData(storageKey, seedFn);
}

/**
 * React hook: auto-syncs data on mount, saves on every change
 */
export function useSyncData<T>(
  apiType: string,
  storageKey: string,
  seedFn?: () => T[]
): [T[], (data: T[]) => void, boolean] {
  const data = getData<T>(storageKey, seedFn);
  // Note: This is a simplified version. For production, use actual React state.
  return [data, (newData: T[]) => saveData(apiType, storageKey, newData), false];
}