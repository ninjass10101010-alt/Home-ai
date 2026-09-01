"use client";
import { useEffect } from "react";
import { flushPendingWrites } from "@/lib/pending-writes";

const DATA_EPOCH_KEY = "consuela-data-epoch";
// Epoch 2: wipes the calendar's stale localStorage cache (the removed
// hardcoded demo events had been re-seeded into `consuela-events` on every
// device). Google events re-sync from the server on mount; family events
// load from PocketBase.
const CURRENT_EPOCH = 2;

const DEMO_KEYS = [
  "consuela-tasks",
  "consuela-meals",
  "consuela-grocery",
  "consuela-pantry",
  "consuela-recipes",
  "consuela-schedules",
  "consuela-events",
  "consuela-week-data",
  "consuela-recently-bought",
  "consuela-chat-messages",
];

export default function SyncInit() {
  useEffect(() => {
    const epoch = Number(localStorage.getItem(DATA_EPOCH_KEY) || "0");
    if (epoch < CURRENT_EPOCH) {
      for (const key of DEMO_KEYS) {
        localStorage.removeItem(key);
      }
      localStorage.setItem(DATA_EPOCH_KEY, String(CURRENT_EPOCH));
    }

    // Replay any meal/recipe writes that failed while the session was
    // unavailable (flushPendingWrites also runs on the CacheRefresher tick
    // and after sign-in).
    flushPendingWrites();
  }, []);
  return null;
}
