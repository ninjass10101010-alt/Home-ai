/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from "react";
import { db } from "@/db";
import { GroceryItem, PantryItem } from "@/types/meals";

const PANTRY_KEY = "consuela-pantry";

const loadJSON = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
};

const normalizeName = (name: string) => name.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function usePantry(showToast: (msg: string) => void, groceryItems: GroceryItem[] = []) {
  const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const local = loadJSON<PantryItem[]>(PANTRY_KEY, []);
    db.selectPantry().then((pbRaw: any) => {
      const pbData = pbRaw.filter((p: any) => p.name || p.item).map((p: any) => ({ id: p.id, item: p.name || p.item, status: p.status, quantity: p.quantity, unit: p.unit }));
      if (pbData.length > 0) {
        const merged = [...pbData];
        const pbIds = new Set(pbData.map((p: PantryItem) => String(p.id)));
        const pbNames = new Set(pbData.map((p: PantryItem) => normalizeName(p.item || "")));
        for (const item of local) {
          if (!pbIds.has(String(item.id)) && !pbNames.has(normalizeName(item.item || ""))) {
            merged.push(item);
          }
        }
        setPantryItems(merged);
      } else {
        setPantryItems(local.length > 0 ? local : pbData);
      }
      setLoaded(true);
    }).catch(() => {
      setPantryItems(local.length > 0 ? local : []);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(PANTRY_KEY, JSON.stringify(pantryItems));
  }, [pantryItems, loaded]);

  const addPantryItem = async (
    name: string,
    status: "plenty" | "low" | "out",
    opts: { quantity?: number; unit?: string; silent?: boolean } = {}
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const exists = pantryItems.some(p => normalizeName(p.item || "") === normalizeName(trimmed));
    if (exists) { if (!opts.silent) showToast("Item already in pantry"); return false; }
    const alreadyOnGrocery = groceryItems.some(g => normalizeName(g.name) === normalizeName(trimmed) && g.needed);
    let saved: any = null;
    try {
      saved = await db.upsertPantryItem({ userId: "demo", name: trimmed, status, quantity: opts.quantity, unit: opts.unit });
    } catch { saved = null; }
    const newItem: PantryItem = {
      id: saved?.id ?? Date.now(),
      item: saved?.name || saved?.item || trimmed,
      status: saved?.status || status,
      quantity: opts.quantity,
      unit: opts.unit,
    };
    setPantryItems(prev => [...prev, newItem]);
    if (!opts.silent) showToast(alreadyOnGrocery ? `🥫 Added ${trimmed} to pantry and grocery` : `🥫 Added ${trimmed} to pantry`);
    return newItem;
  };

  const updatePantryStatus = async (id: number | string, status: "plenty" | "low" | "out") => {
    const item = pantryItems.find(p => p.id === id);
    if (!item) return;
    setPantryItems(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    try { await db.upsertPantryItem({ userId: "demo", name: item.item, status }); } catch { /* best-effort */ }
  };

  const removePantryItem = async (id: number | string) => {
    setPantryItems(prev => prev.filter(p => p.id !== id));
    try { await db.deletePantryItem(id); } catch { /* best-effort */ }
  };

  return {
    pantryItems,
    addPantryItem,
    updatePantryStatus,
    removePantryItem,
  };
}
