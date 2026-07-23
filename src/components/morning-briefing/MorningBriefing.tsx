'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { BriefingAnimation } from './BriefingAnimation';
import { WeatherWidget } from './WeatherWidget';
import { CalendarPreview } from './CalendarPreview';
import { ReminderList } from './ReminderList';
import { DailyQuote } from './DailyQuote';
import { useMorningBriefing } from '@/hooks/useMorningBriefing';
import type { DailyQuote as DailyQuoteType } from '@/db/features/morning-briefing';
import { OutfitSuggestion } from './OutfitSuggestion';

export function MorningBriefing() {
  const {
    briefing,
    isVisible,
    isAnimating,
    dismissBriefing,
    snoozeBriefing,
  } = useMorningBriefing();

  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    if (isVisible && !isAnimating) {
      // Start content reveal after animation completes
      const timer = setTimeout(() => setShowContent(true), 300);
      return () => clearTimeout(timer);
    } else {
      setShowContent(false);
    }
  }, [isVisible, isAnimating]);

  if (!briefing || !isVisible) return null;

  const handleDismiss = () => {
    setShowContent(false);
    setTimeout(() => dismissBriefing(), 200);
  };

  const handleSnooze = () => {
    setShowContent(false);
    setTimeout(() => snoozeBriefing(30), 200); // Snooze for 30 minutes
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-x-0 top-0 z-50 px-4 pt-4"
        >
          <div className="mx-auto max-w-4xl">
            <BriefingAnimation isVisible={showContent}>
              <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/95 shadow-2xl backdrop-blur-md">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <span className="text-2xl">☀️</span>
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        Good Morning, {briefing.familyName}!
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {briefing.date}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSnooze}
                      className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
                    >
                      Snooze 30m
                    </button>
                    <button
                      onClick={handleDismiss}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                      aria-label="Dismiss briefing"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Content Grid */}
                {showContent && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2, duration: 0.4 }}
                    className="grid gap-6 p-6 md:grid-cols-2"
                  >
                    {/* Left Column */}
                    <div className="space-y-6">
                      {/* Weather Widget */}
                      {briefing.showWeather && briefing.weather && (
                        <WeatherWidget
                          temperature={briefing.weather.temperature}
                          condition={briefing.weather.condition}
                          high={briefing.weather.high}
                          low={briefing.weather.low}
                        />
                      )}

                      {/* Outfit Suggestion */}
                      {briefing.showWeather && briefing.weather && briefing.outfitSuggestion && (
                        <OutfitSuggestion suggestion={briefing.outfitSuggestion} />
                      )}

                      {/* Calendar Preview */}
                      {briefing.showCalendar && briefing.calendar.length > 0 && (
                        <CalendarPreview events={briefing.calendar} />
                      )}
                    </div>

                    {/* Right Column */}
                    <div className="space-y-6">
                      {/* Reminders */}
                      {briefing.showReminders && briefing.reminders.length > 0 && (
                        <ReminderList reminders={briefing.reminders} />
                      )}

                      {/* Daily Quote */}
                      {briefing.showQuote && briefing.quote && (
                        <DailyQuote quote={briefing.quote} />
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Footer */}
                <div className="border-t border-border/50 bg-muted/30 px-6 py-3">
                  <p className="text-center text-xs text-muted-foreground">
                    Tip: You can customize your morning briefing in Settings
                  </p>
                </div>
              </div>
            </BriefingAnimation>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
