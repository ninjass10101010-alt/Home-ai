"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { localPreviousDayISO, localTodayISO } from "@/lib/local-date";
import { applyTasksSnapshotToStores } from "@/lib/task-utils";
import {
  DEFAULT_ACCOUNTABILITY_STATE,
  DEFAULT_ROUTINE_SETTINGS,
  DEFAULT_ROUTINES,
  type DailyRoutineProgress,
  type FamilyRoutine,
  type RoutineAccountabilityState,
  type RoutineCompletionMeta,
  type RoutineSettings,
} from "@/types/routines";
import { sanitizeDailyRoutineProgress } from "@/lib/routine-rules";

export interface RoutineActionResult {
  ok: boolean;
  error?: string;
  status?: number;
  pointsDelta?: number;
  completion?: RoutineCompletionMeta | null;
}

const EMPTY_PROGRESS: DailyRoutineProgress = {
  checkedSteps: {},
  completedRoutines: {},
  memberCheckedSteps: {},
  memberCompleted: {},
};

function notifyDataRefreshed(weekData?: unknown) {
  if (weekData && typeof window !== "undefined") {
    applyTasksSnapshotToStores({ weekData });
    window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
  }
}

export function useRoutines(selectedDate?: string) {
  const [todayISO, setTodayISO] = useState<string>(() => localTodayISO());
  const dateISO = selectedDate || todayISO;
  const yesterdayISO = localPreviousDayISO(todayISO);

  const [routines, setRoutines] = useState<FamilyRoutine[]>(DEFAULT_ROUTINES);
  const [settings, setSettings] = useState<RoutineSettings>(DEFAULT_ROUTINE_SETTINGS);
  const [progress, setProgress] = useState<DailyRoutineProgress>(EMPTY_PROGRESS);
  const [accountability, setAccountability] = useState<RoutineAccountabilityState>(
    DEFAULT_ACCOUNTABILITY_STATE,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const currentToday = localTodayISO();
    const targetDate = selectedDate || currentToday;
    try {
      const [routinesRes, progressRes] = await Promise.all([
        fetch("/api/routines", { cache: "no-store" })
          .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
          .catch(() => null),
        fetch(`/api/routines/progress?date=${encodeURIComponent(targetDate)}`, {
          cache: "no-store",
        })
          .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
          .catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setTodayISO(currentToday);

      if (routinesRes?.ok && Array.isArray(routinesRes.d?.routines)) {
        setRoutines(routinesRes.d.routines);
        if (routinesRes.d.settings) setSettings(routinesRes.d.settings);
        if (routinesRes.d.accountability) {
          setAccountability(routinesRes.d.accountability);
        }
        setError(null);
      } else if (
        routinesRes &&
        !routinesRes.ok &&
        routinesRes.d?.error &&
        routinesRes.d.error !== "action_failed"
      ) {
        setError(routinesRes.d.error);
      }

      if (progressRes?.ok && progressRes.d?.progress) {
        setProgress(sanitizeDailyRoutineProgress(progressRes.d.progress, targetDate));
        if (progressRes.d.settings) setSettings(progressRes.d.settings);
        if (progressRes.d.accountability) {
          setAccountability(progressRes.d.accountability);
        }
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 60_000);
    const onFocus = () => void refresh();
    const onSync = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("consuela-data-refreshed", onSync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("consuela-data-refreshed", onSync);
    };
  }, [refresh]);

  const setKeyBusy = (key: string, val: boolean) => {
    setBusyIds((prev) => {
      if (!val) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: true };
    });
  };

  const postProgressAction = useCallback(
    async (
      busyKey: string,
      payload: Record<string, unknown>,
      pin?: string,
    ): Promise<RoutineActionResult> => {
      setKeyBusy(busyKey, true);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (pin) headers["x-admin-pin"] = pin;
        const res = await fetch("/api/routines/progress", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...payload, date: payload.date ?? dateISO }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          return {
            ok: false,
            status: res.status,
            error: data?.error || "action_failed",
          };
        }
        if (mountedRef.current) {
          if (data.progress) {
            setProgress(sanitizeDailyRoutineProgress(data.progress, dateISO));
          }
          if (data.accountability) {
            setAccountability(data.accountability);
          }
        }
        notifyDataRefreshed(data.weekData);
        return {
          ok: true,
          status: res.status,
          pointsDelta: Number(data.pointsDelta || 0),
          completion: data.completion ?? null,
        };
      } catch {
        return { ok: false, error: "network_error" };
      } finally {
        if (mountedRef.current) setKeyBusy(busyKey, false);
      }
    },
    [dateISO],
  );

  const toggleStep = useCallback(
    (routineId: string, stepId: string, memberName: string) =>
      postProgressAction(`step:${routineId}:${memberName}`, {
        action: "toggle_step",
        routineId,
        stepId,
        memberName,
      }),
    [postProgressAction],
  );

  const completeRoutine = useCallback(
    (routineId: string, memberName: string) =>
      postProgressAction(`routine:${routineId}:${memberName}`, {
        action: "complete_routine",
        routineId,
        memberName,
      }),
    [postProgressAction],
  );

  const uncompleteRoutine = useCallback(
    (routineId: string, memberName: string) =>
      postProgressAction(`routine:${routineId}:${memberName}`, {
        action: "uncomplete_routine",
        routineId,
        memberName,
      }),
    [postProgressAction],
  );

  const approveRoutine = useCallback(
    (routineId: string, memberName: string, pin?: string) =>
      postProgressAction(
        `approve:${routineId}:${memberName}`,
        { action: "approve_routine", routineId, memberName },
        pin,
      ),
    [postProgressAction],
  );

  const sendBackRoutine = useCallback(
    (routineId: string, memberName: string, pin?: string) =>
      postProgressAction(
        `sendback:${routineId}:${memberName}`,
        { action: "send_back_routine", routineId, memberName },
        pin,
      ),
    [postProgressAction],
  );

  const excuseMissed = useCallback(
    (entryId: string, pin?: string) =>
      postProgressAction(`excuse:${entryId}`, { action: "excuse_missed", entryId }, pin),
    [postProgressAction],
  );

  const postRoutineConfig = useCallback(
    async (
      busyKey: string,
      payload: Record<string, unknown>,
      pin?: string,
    ): Promise<RoutineActionResult> => {
      setKeyBusy(busyKey, true);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (pin) headers["x-admin-pin"] = pin;
        const res = await fetch("/api/routines", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          return {
            ok: false,
            status: res.status,
            error: data?.error || "save_failed",
          };
        }
        if (mountedRef.current) {
          if (Array.isArray(data.routines)) setRoutines(data.routines);
          if (data.settings) setSettings(data.settings);
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("consuela-data-refreshed"));
        }
        return { ok: true, status: res.status };
      } catch {
        return { ok: false, error: "network_error" };
      } finally {
        if (mountedRef.current) setKeyBusy(busyKey, false);
      }
    },
    [],
  );

  const upsertRoutine = useCallback(
    (routine: FamilyRoutine, pin?: string) =>
      postRoutineConfig(`upsert:${routine.id}`, { action: "upsert_routine", routine }, pin),
    [postRoutineConfig],
  );

  const deleteRoutine = useCallback(
    (routineId: string, pin?: string) =>
      postRoutineConfig(`delete:${routineId}`, { action: "delete_routine", routineId }, pin),
    [postRoutineConfig],
  );

  const updateSettings = useCallback(
    (nextSettings: RoutineSettings, pin?: string) =>
      postRoutineConfig(
        "settings",
        { action: "update_settings", settings: nextSettings },
        pin,
      ),
    [postRoutineConfig],
  );

  return {
    todayISO,
    yesterdayISO,
    dateISO,
    routines,
    settings,
    progress,
    accountability,
    loading,
    error,
    busyIds,
    refresh,
    toggleStep,
    completeRoutine,
    uncompleteRoutine,
    approveRoutine,
    sendBackRoutine,
    excuseMissed,
    upsertRoutine,
    deleteRoutine,
    updateSettings,
  };
}
