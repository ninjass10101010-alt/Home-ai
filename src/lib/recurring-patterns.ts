/**
 * Recurring Pattern Learning
 * AI detects recurring events and suggests auto-scheduling for routines
 * Learns from family patterns and makes intelligent scheduling suggestions
 */

import { getPB } from './pb';
import { createCalendarEvent } from './google/calendar';

export interface RecurringPattern {
  id: string;
  familyId: string;
  patternKey: string; // Unique identifier (e.g., "soccer_practice_caspian")
  title: string;
  category: string;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  time: string; // HH:MM format
  duration: number; // minutes
  occurrences: number;
  confidence: number; // 0-1
  lastOccurrence?: string;
  nextOccurrence?: string;
  autoScheduleEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PatternSuggestion {
  pattern: RecurringPattern;
  reason: string;
  proposedSchedule: {
    start: string;
    end: string;
  };
  confidence: number;
  similarPastEvents: number;
}

export interface PatternDetectionResult {
  patterns: RecurringPattern[];
  suggestions: PatternSuggestion[];
  stats: {
    totalPatternsDetected: number;
    autoScheduleEnabled: number;
    averageConfidence: number;
  };
}

/**
 * Analyze past events to detect recurring patterns
 */
export async function detectRecurringPatterns(
  familyId: string,
  lookbackDays: number = 90
): Promise<PatternDetectionResult> {
  try {
    const pb = getPB();
    
    // Fetch past events
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const events = await pb.collection('consuela_events').getFullList({
      filter: `familyId = "${familyId}" && date >= "${startDate.toISOString()}"`,
      sort: 'date',
      requestKey: null,
    });

    // Group events by pattern key
    const patternMap: Record<string, any[]> = {};

    events.forEach((event: any) => {
      const eventDate = new Date(event.date);
      const dayOfWeek = eventDate.getDay();
      const time = `${String(eventDate.getHours()).padStart(2, '0')}:${String(eventDate.getMinutes()).padStart(2, '0')}`;
      const title = event.title.toLowerCase();
      const category = event.category || 'other';

      // Create pattern key from title, day, and time
      const patternKey = `${title}_${dayOfWeek}_${time}`;

      if (!patternMap[patternKey]) patternMap[patternKey] = [];
      patternMap[patternKey].push({
        ...event,
        patternKey,
        dayOfWeek,
        time,
        category,
      });
    });

    // Detect patterns (events that occur 3+ times on same day/time)
    const patterns: RecurringPattern[] = [];
    const suggestions: PatternSuggestion[] = [];

    for (const [patternKey, occurrences] of Object.entries(patternMap)) {
      if (occurrences.length >= 3) {
        const avgConfidence = Math.min(1, occurrences.length / 10);
        const firstEvent = occurrences[0];
        const lastEvent = occurrences[occurrences.length - 1];

        const pattern: RecurringPattern = {
          id: `pattern_${patternKey}`,
          familyId,
          patternKey,
          title: firstEvent.title,
          category: firstEvent.category,
          dayOfWeek: firstEvent.dayOfWeek,
          time: firstEvent.time,
          duration: firstEvent.duration || 60,
          occurrences: occurrences.length,
          confidence: avgConfidence,
          lastOccurrence: lastEvent.date,
          autoScheduleEnabled: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        patterns.push(pattern);

        // Generate suggestion if confidence is high enough
        if (avgConfidence >= 0.5) {
          const nextOccurrence = calculateNextOccurrence(
            firstEvent.dayOfWeek,
            firstEvent.time,
            firstEvent.duration || 60
          );

          suggestions.push({
            pattern,
            reason: `This event has occurred ${occurrences.length} times on ${getDayName(firstEvent.dayOfWeek)} at ${formatTime(firstEvent.time)}.`,
            proposedSchedule: {
              start: nextOccurrence.toISOString(),
              end: new Date(nextOccurrence.getTime() + (firstEvent.duration || 60) * 60000).toISOString(),
            },
            confidence: avgConfidence,
            similarPastEvents: occurrences.length,
          });
        }
      }
    }

    // Sort by confidence
    patterns.sort((a, b) => b.confidence - a.confidence);
    suggestions.sort((a, b) => b.confidence - a.confidence);

    return {
      patterns,
      suggestions,
      stats: {
        totalPatternsDetected: patterns.length,
        autoScheduleEnabled: patterns.filter(p => p.autoScheduleEnabled).length,
        averageConfidence: patterns.length > 0
          ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
          : 0,
      },
    };
  } catch (error) {
    console.error('Failed to detect recurring patterns:', error);
    throw error;
  }
}

/**
 * Store a detected pattern
 */
export async function storePattern(pattern: RecurringPattern): Promise<boolean> {
  try {
    const pb = getPB();
    
    // Check if pattern already exists
    const existing = await pb.collection('consuela_recurring_patterns').getFirstListItem(
      `patternKey = "${pattern.patternKey}"`,
      { requestKey: null }
    ).catch(() => null);

    if (existing) {
      // Update existing pattern
      await pb.collection('consuela_recurring_patterns').update(
        existing.id,
        {
          occurrences: pattern.occurrences,
          confidence: pattern.confidence,
          lastOccurrence: pattern.lastOccurrence,
          updatedAt: new Date().toISOString(),
        },
        { requestKey: null }
      );
    } else {
      // Create new pattern
      await pb.collection('consuela_recurring_patterns').create(pattern, {
        requestKey: null,
      });
    }

    return true;
  } catch (error) {
    console.error('Failed to store pattern:', error);
    return false;
  }
}

/**
 * Enable auto-scheduling for a pattern
 */
export async function enableAutoSchedule(patternId: string): Promise<boolean> {
  try {
    const pb = getPB();
    
    await pb.collection('consuela_recurring_patterns').update(
      patternId,
      {
        autoScheduleEnabled: true,
        updatedAt: new Date().toISOString(),
      },
      { requestKey: null }
    );

    return true;
  } catch (error) {
    console.error('Failed to enable auto-schedule:', error);
    return false;
  }
}

/**
 * Disable auto-scheduling for a pattern
 */
export async function disableAutoSchedule(patternId: string): Promise<boolean> {
  try {
    const pb = getPB();
    
    await pb.collection('consuela_recurring_patterns').update(
      patternId,
      {
        autoScheduleEnabled: false,
        updatedAt: new Date().toISOString(),
      },
      { requestKey: null }
    );

    return true;
  } catch (error) {
    console.error('Failed to disable auto-schedule:', error);
    return false;
  }
}

/**
 * Get all patterns for a family
 */
export async function getFamilyPatterns(familyId: string): Promise<RecurringPattern[]> {
  try {
    const pb = getPB();
    
    const patterns = await pb.collection('consuela_recurring_patterns').getFullList({
      filter: `familyId = "${familyId}"`,
      sort: '-confidence',
      requestKey: null,
    });

    return patterns as unknown as RecurringPattern[];
  } catch (error) {
    console.error('Failed to get family patterns:', error);
    return [];
  }
}

/**
 * Auto-schedule upcoming events based on patterns
 */
export async function autoScheduleUpcomingEvents(
  familyId: string,
  daysAhead: number = 7
): Promise<{ scheduled: number; errors: number }> {
  try {
    const patterns = await getFamilyPatterns(familyId);
    const autoPatterns = patterns.filter(p => p.autoScheduleEnabled && p.confidence >= 0.7);

    let scheduled = 0;
    let errors = 0;

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    for (const pattern of autoPatterns) {
      try {
        // Calculate next occurrence
        const nextDate = calculateNextOccurrence(
          pattern.dayOfWeek,
          pattern.time,
          pattern.duration
        );

        // Check if within range
        if (nextDate >= startDate && nextDate <= endDate) {
          // Check if event already exists
          const pb = getPB();
          const existing = await pb.collection('consuela_events').getFirstListItem(
            `familyId = "${familyId}" && title = "${pattern.title}" && date >= "${nextDate.toISOString()}" && date < "${new Date(nextDate.getTime() + 60000).toISOString()}"`,
            { requestKey: null }
          ).catch(() => null);

          if (!existing) {
            // Create event
            await createCalendarEvent({
              summary: pattern.title,
              start: { dateTime: nextDate.toISOString() },
              end: { dateTime: new Date(nextDate.getTime() + pattern.duration * 60000).toISOString() },
              description: `Auto-scheduled based on pattern (confidence: ${Math.round(pattern.confidence * 100)}%)`,
            });

            // Store in database
            await pb.collection('consuela_events').create({
              familyId,
              title: pattern.title,
              date: nextDate.toISOString(),
              duration: pattern.duration,
              category: pattern.category,
              source: 'auto_schedule',
              patternId: pattern.id,
              createdAt: new Date().toISOString(),
            }, { requestKey: null });

            scheduled++;
          }
        }
      } catch (error) {
        console.error(`Failed to auto-schedule pattern ${pattern.id}:`, error);
        errors++;
      }
    }

    return { scheduled, errors };
  } catch (error) {
    console.error('Failed to auto-schedule events:', error);
    return { scheduled: 0, errors: 1 };
  }
}

/**
 * Calculate next occurrence of a recurring event
 */
function calculateNextOccurrence(
  dayOfWeek: number,
  time: string,
  duration: number
): Date {
  const now = new Date();
  const [hours, minutes] = time.split(':').map(Number);
  
  // Start from tomorrow
  const nextDate = new Date(now);
  nextDate.setDate(nextDate.getDate() + 1);
  nextDate.setHours(hours, minutes, 0, 0);

  // Find next occurrence of the day
  while (nextDate.getDay() !== dayOfWeek) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  return nextDate;
}

/**
 * Get day name from day of week number
 */
function getDayName(dayOfWeek: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek];
}

/**
 * Format time from HH:MM to readable format
 */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
}

/**
 * Suggest patterns based on current events
 */
export async function suggestPatterns(
  familyId: string,
  recentEvents: any[]
): Promise<PatternSuggestion[]> {
  try {
    const suggestions: PatternSuggestion[] = [];

    // Group events by title, day, and time
    const grouped: Record<string, any[]> = {};
    
    recentEvents.forEach(event => {
      const eventDate = new Date(event.date);
      const dayOfWeek = eventDate.getDay();
      const time = `${String(eventDate.getHours()).padStart(2, '0')}:${String(eventDate.getMinutes()).padStart(2, '0')}`;
      const key = `${event.title.toLowerCase()}_${dayOfWeek}_${time}`;

      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(event);
    });

    // Find potential patterns
    for (const [key, events] of Object.entries(grouped)) {
      if (events.length >= 2) {
        const [hours, minutes] = key.split('_')[2].split(':').map(Number);
        const dayOfWeek = parseInt(key.split('_')[1]);
        const title = events[0].title;

        const nextOccurrence = calculateNextOccurrence(dayOfWeek, `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, events[0].duration || 60);

        suggestions.push({
          pattern: {
            id: `suggested_${key}`,
            familyId,
            patternKey: key,
            title,
            category: events[0].category || 'other',
            dayOfWeek,
            time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
            duration: events[0].duration || 60,
            occurrences: events.length,
            confidence: Math.min(1, events.length / 5),
            autoScheduleEnabled: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          reason: `This event has occurred ${events.length} times on ${getDayName(dayOfWeek)} at ${formatTime(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`)}.`,
          proposedSchedule: {
            start: nextOccurrence.toISOString(),
            end: new Date(nextOccurrence.getTime() + (events[0].duration || 60) * 60000).toISOString(),
          },
          confidence: Math.min(1, events.length / 5),
          similarPastEvents: events.length,
        });
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  } catch (error) {
    console.error('Failed to suggest patterns:', error);
    return [];
  }
}

/**
 * Delete a pattern
 */
export async function deletePattern(patternId: string): Promise<boolean> {
  try {
    const pb = getPB();
    await pb.collection('consuela_recurring_patterns').delete(patternId, {
      requestKey: null,
    });
    return true;
  } catch (error) {
    console.error('Failed to delete pattern:', error);
    return false;
  }
}
