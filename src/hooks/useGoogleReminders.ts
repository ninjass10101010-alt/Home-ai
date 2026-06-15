"use client";

import { useCallback, useEffect, useState } from "react";

export interface GoogleReminder {
  id: string;
  google_id: string;
  tasklist_id: string;
  title: string;
  notes?: string;
  due: string;
  status: "needsAction" | "completed";
  completed?: string;
  kind: "chore" | "reminder";
  etag?: string;
  updated_remote?: string;
  raw?: any;
}

export interface GoogleRemindersState {
  reminders: GoogleReminder[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  tasksScopeGranted: boolean;
  notice: string | null;
  refresh: () => Promise<void>;
  complete: (reminder: GoogleReminder) => Promise<void>;
  uncomplete: (reminder: GoogleReminder) => Promise<void>;
  add: (input: { title: string; due: string; notes?: string }) => Promise<boolean>;
}

export function useGoogleReminders(autoSync = true): GoogleRemindersState {
  const [reminders, setReminders] = useState<GoogleReminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [tasksScopeGranted, setTasksScopeGranted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/google-tasks?resource=reminders", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to load reminders");
        return;
      }
      setConnected(!!data.connected);
      setTasksScopeGranted(!!data.tasks_scope_granted);
      setNotice(data?.notice || null);
      setReminders(data.reminders || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load reminders");
    } finally {
      setLoading(false);
    }
  }, []);

  const complete = useCallback(async (reminder: GoogleReminder) => {
    setError(null);
    setReminders((prev) =>
      prev.map((r) => (r.google_id === reminder.google_id ? { ...r, status: "completed" } : r)),
    );
    try {
      const res = await fetch("/api/google-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          tasklistId: reminder.tasklist_id,
          taskId: reminder.google_id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Failed to complete reminder");
        await refresh();
      } else {
        await refresh();
      }
    } catch (e: any) {
      setError(e?.message || "Failed to complete reminder");
      await refresh();
    }
  }, [refresh]);

  const uncomplete = useCallback(async (reminder: GoogleReminder) => {
    setError(null);
    setReminders((prev) =>
      prev.map((r) => (r.google_id === reminder.google_id ? { ...r, status: "needsAction" } : r)),
    );
    try {
      const res = await fetch("/api/google-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "uncomplete",
          tasklistId: reminder.tasklist_id,
          taskId: reminder.google_id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Failed to reopen reminder");
        await refresh();
      } else {
        await refresh();
      }
    } catch (e: any) {
      setError(e?.message || "Failed to reopen reminder");
      await refresh();
    }
  }, [refresh]);

  const add = useCallback(async (input: { title: string; due: string; notes?: string }) => {
    setError(null);
    try {
      const res = await fetch("/api/google-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reminder", ...input }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Failed to add reminder");
        return false;
      }
      await refresh();
      return true;
    } catch (e: any) {
      setError(e?.message || "Failed to add reminder");
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    if (!autoSync) return;
    const t = window.setTimeout(refresh, 0);
    const id = window.setInterval(refresh, 5 * 60 * 1000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [autoSync, refresh]);

  return {
    reminders,
    loading,
    error,
    connected,
    tasksScopeGranted,
    notice,
    refresh,
    complete,
    uncomplete,
    add,
  };
}

export function bucketReminders(reminders: GoogleReminder[]) {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const active = reminders.filter((r) => r.status === "needsAction");

  const overdue: GoogleReminder[] = [];
  const todayList: GoogleReminder[] = [];
  const tomorrowList: GoogleReminder[] = [];
  const thisWeek: GoogleReminder[] = [];
  const later: GoogleReminder[] = [];

  for (const r of active) {
    const due = new Date(r.due);
    if (Number.isNaN(due.getTime())) {
      later.push(r);
      continue;
    }
    if (due.getTime() < now && due.getTime() < today.getTime()) {
      overdue.push(r);
    } else if (due.getTime() < tomorrow.getTime()) {
      todayList.push(r);
    } else if (due.getTime() < dayAfter.getTime()) {
      tomorrowList.push(r);
    } else if (due.getTime() < weekEnd.getTime()) {
      thisWeek.push(r);
    } else {
      later.push(r);
    }
  }

  return { overdue, today: todayList, tomorrow: tomorrowList, thisWeek, later };
}
