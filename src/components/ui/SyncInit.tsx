"use client";
import { useEffect } from "react";
import { mergeAndSync, pushLocal } from "@/lib/sync-service";

const DATA_EPOCH_KEY = "consuela-data-epoch";
const CURRENT_EPOCH = 1;

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

    const types = [
      ["events", "consuela-events"],
      ["tasks", "consuela-tasks"],
      ["schedules", "consuela-schedules"],
      ["meals", "consuela-meals"],
      ["rewards", "consuela-rewards"],
      ["recipes", "consuela-recipes"],
    ];
    for (const [type, key] of types) {
      mergeAndSync(type, key); pushLocal(type, key);
    }
  }, []);
  return null;
}
