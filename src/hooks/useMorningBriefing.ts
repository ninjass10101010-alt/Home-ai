'use client';

import { useState, useEffect, useCallback } from 'react';
import { getBriefingData } from '@/lib/morning-briefing';
import type { MorningBriefingData } from '@/lib/morning-briefing';

const BRIEFING_DISMISSED_KEY = 'morning-briefing-dismissed';
const BRIEFING_SNOOZED_KEY = 'morning-briefing-snoozed';

export function useMorningBriefing() {
  const [briefing, setBriefing] = useState<MorningBriefingData | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [loading, setLoading] = useState(true);

  // Check if briefing should be shown
  const shouldShowBriefing = useCallback((): boolean => {
    const now = new Date();
    const hour = now.getHours();

    // Only show between 6 AM and 11 AM
    if (hour < 6 || hour > 11) {
      return false;
    }

    // Check if dismissed today
    const dismissedDate = localStorage.getItem(BRIEFING_DISMISSED_KEY);
    if (dismissedDate) {
      const dismissed = new Date(dismissedDate);
      const isSameDay =
        dismissed.getDate() === now.getDate() &&
        dismissed.getMonth() === now.getMonth() &&
        dismissed.getFullYear() === now.getFullYear();
      if (isSameDay) {
        return false;
      }
    }

    // Check if snoozed
    const snoozedUntil = localStorage.getItem(BRIEFING_SNOOZED_KEY);
    if (snoozedUntil) {
      const snoozeEnd = new Date(snoozedUntil);
      if (now < snoozeEnd) {
        return false;
      }
    }

    return true;
  }, []);

  // Load briefing data
  const loadBriefing = useCallback(async () => {
    if (!shouldShowBriefing()) {
      setLoading(false);
      return;
    }

    try {
      setIsAnimating(true);
      const data = await getBriefingData();
      setBriefing(data);
      setIsVisible(true);
      
      // Animation completes after 300ms
      setTimeout(() => setIsAnimating(false), 300);
    } catch (error) {
      console.error('Failed to load morning briefing:', error);
    } finally {
      setLoading(false);
    }
  }, [shouldShowBriefing]);

  // Dismiss briefing for today
  const dismissBriefing = useCallback(() => {
    setIsVisible(false);
    const now = new Date().toISOString();
    localStorage.setItem(BRIEFING_DISMISSED_KEY, now);
  }, []);

  // Snooze briefing for specified minutes
  const snoozeBriefing = useCallback((minutes: number) => {
    setIsVisible(false);
    const snoozeEnd = new Date(Date.now() + minutes * 60 * 1000);
    localStorage.setItem(BRIEFING_SNOOZED_KEY, snoozeEnd.toISOString());
  }, []);

  // Load briefing on mount
  useEffect(() => {
    loadBriefing();
  }, [loadBriefing]);

  return {
    briefing,
    isVisible,
    isAnimating,
    loading,
    dismissBriefing,
    snoozeBriefing,
    reloadBriefing: loadBriefing,
  };
}
