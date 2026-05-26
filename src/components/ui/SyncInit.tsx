"use client";
import { useEffect } from "react";
import { mergeAndSync, pushLocal } from "@/lib/sync-service";

export default function SyncInit() {
  useEffect(() => {
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
