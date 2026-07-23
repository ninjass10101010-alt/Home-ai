/**
 * Auto-Buffer Scheduling Library
 * Automatically adds buffer time and travel time between events
 */

import type { GoogleCalendarEvent } from './google/types.ts';
import { createCalendarEvent, readCachedEvents } from './google/calendar.ts';
import { withAdmin } from './pb-auth.ts';

export interface BufferEvent {
  type: 'travel' | 'buffer' | 'prep';
  start: string;
  end: string;
  duration: number; // minutes
  description: string;
  relatedEventId: string;
}

export interface BufferSettings {
  enabled: boolean;
  defaultBufferMinutes: number; // Buffer before/after events
  travelTimeMinutes: number; // Default travel time
  minGapMinutes: number; // Minimum gap between events
  createBufferEvents: boolean; // Whether to create actual calendar events
  bufferColor: string; // Color for buffer events
}

const DEFAULT_SETTINGS: BufferSettings = {
  enabled: true,
  defaultBufferMinutes: 10,
  travelTimeMinutes: 15,
  minGapMinutes: 5,
  createBufferEvents: true,
  bufferColor: '#9ca3af', // Gray
};

/**
 * Get buffer settings from database or use defaults
 */
export async function getBufferSettings(): Promise<BufferSettings> {
  try {
    const settings = await withAdmin(async (pb) => {
      const rows = await pb
        .collection('consuela_buffer_settings')
        .getFullList({ requestKey: null });
      return rows[0] || null;
    });

    if (settings) {
      return {
        enabled: settings.enabled ?? DEFAULT_SETTINGS.enabled,
        defaultBufferMinutes: settings.default_buffer_minutes ?? DEFAULT_SETTINGS.defaultBufferMinutes,
        travelTimeMinutes: settings.travel_time_minutes ?? DEFAULT_SETTINGS.travelTimeMinutes,
        minGapMinutes: settings.min_gap_minutes ?? DEFAULT_SETTINGS.minGapMinutes,
        createBufferEvents: settings.create_buffer_events ?? DEFAULT_SETTINGS.createBufferEvents,
        bufferColor: settings.buffer_color ?? DEFAULT_SETTINGS.bufferColor,
      };
    }

    return DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save buffer settings to database
 */
export async function saveBufferSettings(settings: BufferSettings): Promise<void> {
  await withAdmin(async (pb) => {
    const rows = await pb
      .collection('consuela_buffer_settings')
      .getFullList({ requestKey: null });

    const payload = {
      enabled: settings.enabled,
      default_buffer_minutes: settings.defaultBufferMinutes,
      travel_time_minutes: settings.travelTimeMinutes,
      min_gap_minutes: settings.minGapMinutes,
      create_buffer_events: settings.createBufferEvents,
      buffer_color: settings.bufferColor,
    };

    if (rows.length > 0) {
      await pb
        .collection('consuela_buffer_settings')
        .update(rows[0].id, payload, { requestKey: null });
    } else {
      await pb
        .collection('consuela_buffer_settings')
        .create(payload, { requestKey: null });
    }
  });
}

/**
 * Calculate travel time between two locations
 * TODO: Integrate with Google Maps Distance Matrix API
 */
function calculateTravelTime(fromLocation?: string, toLocation?: string): number {
  if (fromLocation && toLocation && fromLocation !== toLocation) {
    return 15; // Default 15 minutes
  }
  return 0;
}

/**
 * Analyze a time range and identify where buffers are needed
 */
export async function analyzeTimeRange(
  startTime: string,
  endTime: string
): Promise<{
  events: GoogleCalendarEvent[];
  gaps: { start: string; end: string; duration: number }[];
  conflicts: { start: string; end: string; duration: number }[];
}> {
  const cachedEvents = await readCachedEvents();

  // Convert to GoogleCalendarEvent format
  const events: GoogleCalendarEvent[] = cachedEvents
    .filter((e: any) => {
      const eventStart = new Date(e.start_iso);
      return eventStart >= new Date(startTime) && eventStart <= new Date(endTime);
    })
    .map((e: any) => ({
      id: e.google_id,
      summary: e.summary,
      start: { dateTime: e.start_iso },
      end: { dateTime: e.end_iso },
      location: e.location,
    }))
    .sort((a: any, b: any) => new Date(a.start.dateTime!).getTime() - new Date(b.start.dateTime!).getTime());

  // Find gaps and overlaps
  const gaps: { start: string; end: string; duration: number }[] = [];
  const conflicts: { start: string; end: string; duration: number }[] = [];

  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i];
    const next = events[i + 1];

    if (!current.end?.dateTime || !next.start?.dateTime) continue;

    const currentEnd = new Date(current.end.dateTime);
    const nextStart = new Date(next.start.dateTime);
    const gapMinutes = (nextStart.getTime() - currentEnd.getTime()) / (1000 * 60);

    if (gapMinutes < 0) {
      // Overlap
      conflicts.push({
        start: current.end.dateTime,
        end: next.start.dateTime,
        duration: Math.abs(gapMinutes),
      });
    } else if (gapMinutes < 30) {
      // Short gap
      gaps.push({
        start: current.end.dateTime,
        end: next.start.dateTime,
        duration: gapMinutes,
      });
    }
  }

  return { events, gaps, conflicts };
}

/**
 * Suggest buffer times for a new event
 */
export async function suggestBuffers(
  newEvent: {
    start: string;
    end: string;
    location?: string;
  }
): Promise<{
  buffers: BufferEvent[];
  totalBufferTime: number;
}> {
  const settings = await getBufferSettings();
  const buffers: BufferEvent[] = [];

  if (!settings.enabled) {
    return { buffers, totalBufferTime: 0 };
  }

  // Analyze the time range around the new event
  const startTime = new Date(newEvent.start);
  startTime.setHours(startTime.getHours() - 2); // 2 hours before
  const endTime = new Date(newEvent.end);
  endTime.setHours(endTime.getHours() + 2); // 2 hours after

  const { events } = await analyzeTimeRange(
    startTime.toISOString(),
    endTime.toISOString()
  );

  // Filter to events adjacent to the new event
  const newStart = new Date(newEvent.start);
  const newEnd = new Date(newEvent.end);

  // Check event before
  const beforeEvent = events
    .filter((e: any) => e.end?.dateTime && new Date(e.end.dateTime) <= newStart)
    .sort((a: any, b: any) => new Date(b.end.dateTime!).getTime() - new Date(a.end.dateTime!).getTime())[0];

  if (beforeEvent?.end?.dateTime) {
    const beforeEnd = new Date(beforeEvent.end.dateTime);
    const gapMinutes = (newStart.getTime() - beforeEnd.getTime()) / (1000 * 60);

    // Add travel time if locations are different
    const travelTime = calculateTravelTime(beforeEvent.location, newEvent.location);

    // Add buffer if gap is too small
    if (gapMinutes < settings.minGapMinutes + travelTime) {
      const bufferDuration = settings.defaultBufferMinutes;
      const bufferStart = new Date(newStart.getTime() - bufferDuration * 60 * 1000);
      const bufferEnd = newStart;

      buffers.push({
        type: 'buffer',
        start: bufferStart.toISOString(),
        end: bufferEnd.toISOString(),
        duration: bufferDuration,
        description: `Buffer before ${beforeEvent.summary}`,
        relatedEventId: beforeEvent.id!,
      });
    }

    // Add travel time if needed
    if (travelTime > 0 && gapMinutes < travelTime + settings.minGapMinutes) {
      const travelStart = new Date(newStart.getTime() - travelTime * 60 * 1000);
      const travelEnd = newStart;

      buffers.push({
        type: 'travel',
        start: travelStart.toISOString(),
        end: travelEnd.toISOString(),
        duration: travelTime,
        description: `Travel from ${beforeEvent.location || 'previous location'}`,
        relatedEventId: beforeEvent.id!,
      });
    }
  }

  // Check event after
  const afterEvent = events
    .filter((e: any) => e.start?.dateTime && new Date(e.start.dateTime) >= newEnd)
    .sort((a: any, b: any) => new Date(a.start.dateTime!).getTime() - new Date(b.start.dateTime!).getTime())[0];

  if (afterEvent?.start?.dateTime) {
    const afterStart = new Date(afterEvent.start.dateTime);
    const gapMinutes = (afterStart.getTime() - newEnd.getTime()) / (1000 * 60);

    // Add travel time if locations are different
    const travelTime = calculateTravelTime(newEvent.location, afterEvent.location);

    // Add buffer if gap is too small
    if (gapMinutes < settings.minGapMinutes + travelTime) {
      const bufferDuration = settings.defaultBufferMinutes;
      const bufferStart = newEnd;
      const bufferEnd = new Date(newEnd.getTime() + bufferDuration * 60 * 1000);

      buffers.push({
        type: 'buffer',
        start: bufferStart.toISOString(),
        end: bufferEnd.toISOString(),
        duration: bufferDuration,
        description: `Buffer before ${afterEvent.summary}`,
        relatedEventId: afterEvent.id!,
      });
    }

    // Add travel time if needed
    if (travelTime > 0 && gapMinutes < travelTime + settings.minGapMinutes) {
      const travelStart = newEnd;
      const travelEnd = new Date(travelStart.getTime() + travelTime * 60 * 1000);

      buffers.push({
        type: 'travel',
        start: travelStart.toISOString(),
        end: travelEnd.toISOString(),
        duration: travelTime,
        description: `Travel to ${afterEvent.location || 'next location'}`,
        relatedEventId: afterEvent.id!,
      });
    }
  }

  const totalBufferTime = buffers.reduce((sum, b) => sum + b.duration, 0);

  return { buffers, totalBufferTime };
}

/**
 * Create buffer events in Google Calendar
 */
export async function createBufferEvents(
  buffers: BufferEvent[],
  mainEventSummary: string
): Promise<{ created: number; errors: number }> {
  const settings = await getBufferSettings();
  let created = 0;
  let errors = 0;

  if (!settings.createBufferEvents) {
    return { created: 0, errors: 0 };
  }

  for (const buffer of buffers) {
    try {
      const typeIcon = buffer.type === 'travel' ? '🚗' : buffer.type === 'prep' ? '📋' : '⏱️';
      const summary = `${typeIcon} ${buffer.description}`;

      await createCalendarEvent({
        summary,
        description: `Auto-generated buffer for: ${mainEventSummary}`,
        start: { dateTime: buffer.start },
        end: { dateTime: buffer.end },
        extendedProperties: {
          private: {
            source: 'consuelaDashboard',
            type: 'buffer',
            relatedEvent: buffer.relatedEventId,
          },
        },
      });

      created++;
    } catch (error) {
      console.error('Failed to create buffer event:', error);
      errors++;
    }
  }

  return { created, errors };
}

/**
 * Remove buffer events for a specific event
 */
export async function removeBufferEvents(eventId: string): Promise<number> {
  // TODO: Implement buffer event cleanup
  // This would find and delete buffer events related to the main event
  return 0;
}
