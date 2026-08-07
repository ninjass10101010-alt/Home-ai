'use client';

import { useState, useEffect } from 'react';
import { Repeat, CheckCircle, XCircle, Sparkles } from 'lucide-react';
import Card from '@/components/ui/Card';
import Surface from '@/components/ui/Surface';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import type { RecurringPattern, PatternSuggestion } from '@/lib/recurring-patterns';

interface RecurringPatternsWidgetProps {
  familyId: string;
}

export function RecurringPatternsWidget({ familyId }: RecurringPatternsWidgetProps) {
  const [patterns, setPatterns] = useState<RecurringPattern[]>([]);
  const [suggestions, setSuggestions] = useState<PatternSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPatterns();
  }, [familyId]);

  const loadPatterns = async () => {
    setLoading(true);
    setError(null);

    try {
      const [patternsRes, suggestionsRes] = await Promise.all([
        fetch(`/api/recurring-patterns?type=list&familyId=${familyId}`),
        fetch(`/api/recurring-patterns?type=suggest&familyId=${familyId}`),
      ]);

      if (!patternsRes.ok || !suggestionsRes.ok) {
        throw new Error('Failed to load patterns');
      }

      const patternsData = await patternsRes.json();
      const suggestionsData = await suggestionsRes.json();

      setPatterns(patternsData.patterns || []);
      setSuggestions(suggestionsData.suggestions || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEnableAutoSchedule = async (patternId: string) => {
    try {
      const response = await fetch('/api/recurring-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patternId, action: 'enable' }),
      });

      if (response.ok) {
        await loadPatterns();
      }
    } catch (err) {
      console.error('Failed to enable auto-schedule:', err);
    }
  };

  const handleDisableAutoSchedule = async (patternId: string) => {
    try {
      const response = await fetch('/api/recurring-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patternId, action: 'disable' }),
      });

      if (response.ok) {
        await loadPatterns();
      }
    } catch (err) {
      console.error('Failed to disable auto-schedule:', err);
    }
  };

  const handleAcceptSuggestion = async (suggestion: PatternSuggestion) => {
    try {
      // Store the pattern
      await fetch('/api/recurring-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...suggestion.pattern,
          autoScheduleEnabled: true,
        }),
      });

      // Enable auto-schedule
      await handleEnableAutoSchedule(suggestion.pattern.id);
      await loadPatterns();
    } catch (err) {
      console.error('Failed to accept suggestion:', err);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <Card padding="lg">
          <Skeleton className="h-6 w-48 mb-4" />
          <Skeleton className="h-4 w-64 mb-4" />
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </Card>
        <Card padding="lg">
          <Skeleton className="h-6 w-56 mb-4" />
          <div className="space-y-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Unable to Load Patterns"
        description={error}
        icon="🔄"
        actionLabel="Retry"
        onAction={loadPatterns}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Surface
          variant="flat"
          radius="xl"
          padding="lg"
          className="border-2 border-dashed border-[var(--color-accent-selected)]/30"
        >
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-text-primary">
            <Sparkles className="h-5 w-5 text-[var(--color-accent-selected)]" />
            Detected Patterns ({suggestions.length})
          </h3>
          <p className="text-sm text-text-secondary mb-4">
            Consuela detected these recurring events. Enable auto-scheduling to automatically create future occurrences.
          </p>
          <div className="space-y-3">
            {suggestions.map((suggestion, i) => (
              <SuggestionCard
                key={i}
                suggestion={suggestion}
                onAccept={() => handleAcceptSuggestion(suggestion)}
              />
            ))}
          </div>
        </Surface>
      )}

      {/* Existing Patterns */}
      {patterns.length > 0 && (
        <Card padding="lg">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-text-primary">
            <Repeat className="h-5 w-5 text-[var(--color-accent-selected)]" />
            Auto-Scheduled Patterns ({patterns.length})
          </h3>
          <div className="space-y-3">
            {patterns.map((pattern) => (
              <PatternCard
                key={pattern.id}
                pattern={pattern}
                onEnable={() => handleEnableAutoSchedule(pattern.id)}
                onDisable={() => handleDisableAutoSchedule(pattern.id)}
              />
            ))}
          </div>
        </Card>
      )}

      {patterns.length === 0 && suggestions.length === 0 && (
        <EmptyState
          title="No Recurring Patterns Detected"
          description="Consuela will detect patterns as you create more events"
          icon="🔄"
        />
      )}
    </div>
  );
}

function SuggestionCard({ suggestion, onAccept }: {
  suggestion: PatternSuggestion;
  onAccept: () => void;
}) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [hours, minutes] = suggestion.pattern.time.split(':');
  const hour = parseInt(hours);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  const timeStr = `${displayHour}:${minutes} ${period}`;

  return (
    <Card padding="md">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-semibold text-text-primary">{suggestion.pattern.title}</h4>
          <p className="text-sm text-text-secondary">
            {dayNames[suggestion.pattern.dayOfWeek]} at {timeStr}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-secondary">Confidence</div>
          <div className="text-lg font-bold text-[var(--color-accent-selected)]">
            {Math.round(suggestion.confidence * 100)}%
          </div>
        </div>
      </div>
      <p className="text-sm text-text-secondary mb-3">{suggestion.reason}</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">
          {suggestion.similarPastEvents} similar events found
        </span>
        <Button onClick={onAccept}>
          <CheckCircle className="h-4 w-4" />
          Enable Auto-Schedule
        </Button>
      </div>
    </Card>
  );
}

function PatternCard({ pattern, onEnable, onDisable }: {
  pattern: RecurringPattern;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [hours, minutes] = pattern.time.split(':');
  const hour = parseInt(hours);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  const timeStr = `${displayHour}:${minutes} ${period}`;

  return (
    <Surface variant="flat" radius="lg" padding="md" className="flex items-center justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-text-primary">{pattern.title}</span>
          {pattern.autoScheduleEnabled && (
            <Surface
              variant="flat"
              radius="pill"
              padding="none"
              className="text-xs px-2 py-0.5"
            >
              <span className="text-[var(--color-accent-mint)]">Active</span>
            </Surface>
          )}
        </div>
        <div className="text-sm text-text-secondary">
          {dayNames[pattern.dayOfWeek]} at {timeStr} · {pattern.occurrences} occurrences
        </div>
      </div>
      {pattern.autoScheduleEnabled ? (
        <Button variant="danger" onClick={onDisable}>
          <XCircle className="h-4 w-4" />
          Disable
        </Button>
      ) : (
        <Button variant="success" onClick={onEnable}>
          <CheckCircle className="h-4 w-4" />
          Enable
        </Button>
      )}
    </Surface>
  );
}
