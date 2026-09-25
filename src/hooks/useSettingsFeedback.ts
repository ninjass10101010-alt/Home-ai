"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SettingsFeedbackTone = "neutral" | "success" | "error";

export interface SettingsFeedback {
  message: string;
  tone: SettingsFeedbackTone;
}

const FEEDBACK_DURATION_MS = 3000;

export function useSettingsFeedback() {
  const [feedback, setFeedback] = useState<SettingsFeedback | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback((message: string, tone: SettingsFeedbackTone = "neutral") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setFeedback({ message, tone });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setFeedback(null);
    }, FEEDBACK_DURATION_MS);
  }, []);

  const clearFeedback = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setFeedback(null);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { feedback, showFeedback, clearFeedback };
}
