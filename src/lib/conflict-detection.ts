/**
 * Conflict Detection Library
 * Detects scheduling conflicts and suggests resolutions
 */

import type { GoogleCalendarEvent } from './google/types.ts';

export interface Conflict {
  id: string;
  type: 'overlap' | 'travel' | 'resource' | 'double_booked';
  severity: 'low' | 'medium' | 'high';
  events: string[]; // Event IDs
  message: string;
  suggestion?: string;
  resolution?: ConflictResolution;
}

export interface ConflictResolution {
  type: 'reschedule' | 'shorten' | 'delegate' | 'decline';
  description: string;
  newTime?: {
    start: string;
    end: string;
  };
}

export interface ConflictCheckInput {
  newEvent: {
    summary: string;
    start: string; // ISO string
    end: string;   // ISO string
    location?: string;
    attendees?: { email: string }[];
  };
  existingEvents: GoogleCalendarEvent[];
  travelTimeMinutes?: number; // Default travel time in minutes
}

/**
 * Calculate travel time between two locations using Google Maps API
 * For now, returns a default value - can be enhanced with actual API calls
 */
function calculateTravelTime(fromLocation?: string, toLocation?: string): number {
  // TODO: Integrate with Google Maps Distance Matrix API
  // For now, return a default 15 minutes if both locations exist
  if (fromLocation && toLocation && fromLocation !== toLocation) {
    return 15;
  }
  return 0;
}

/**
 * Check if two time ranges overlap
 */
function timesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const s1 = new Date(start1).getTime();
  const e1 = new Date(end1).getTime();
  const s2 = new Date(start2).getTime();
  const e2 = new Date(end2).getTime();

  // Check if ranges overlap
  return s1 < e2 && s2 < e1;
}

/**
 * Calculate overlap duration in minutes
 */
function getOverlapDuration(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): number {
  const s1 = new Date(start1).getTime();
  const e1 = new Date(end1).getTime();
  const s2 = new Date(start2).getTime();
  const e2 = new Date(end2).getTime();

  // Calculate overlap
  const overlapStart = Math.max(s1, s2);
  const overlapEnd = Math.min(e1, e2);

  if (overlapEnd > overlapStart) {
    return (overlapEnd - overlapStart) / (1000 * 60);
  }
  return 0;
}

/**
 * Detect all conflicts for a new event
 */
export function detectConflicts(input: ConflictCheckInput): Conflict[] {
  const conflicts: Conflict[] = [];
  const { newEvent, existingEvents, travelTimeMinutes = 15 } = input;

  const newStart = new Date(newEvent.start);
  const newEnd = new Date(newEvent.end);

  for (const existing of existingEvents) {
    if (!existing.start?.dateTime || !existing.end?.dateTime) continue;

    const existingStart = new Date(existing.start.dateTime);
    const existingEnd = new Date(existing.end.dateTime);

    // Check for time overlap
    if (timesOverlap(newEvent.start, newEvent.end, existing.start.dateTime, existing.end.dateTime)) {
      const overlapMinutes = getOverlapDuration(
        newEvent.start,
        newEvent.end,
        existing.start.dateTime,
        existing.end.dateTime
      );

      const severity = overlapMinutes > 30 ? 'high' : overlapMinutes > 10 ? 'medium' : 'low';

      conflicts.push({
        id: `overlap-${newEvent.start}-${existing.id}`,
        type: 'overlap',
        severity,
        events: [newEvent.start, existing.id],
        message: `Time conflict with "${existing.summary}" (${Math.round(overlapMinutes)} min overlap)`,
        suggestion: overlapMinutes > 15
          ? `Consider rescheduling one of these events`
          : `Brief overlap - you might be able to manage both`,
        resolution: {
          type: 'reschedule',
          description: `Move ${existing.summary} to avoid conflict`,
          // Suggest moving to 30 min after the new event ends
          newTime: {
            start: new Date(newEnd.getTime() + 30 * 60 * 1000).toISOString(),
            end: new Date(newEnd.getTime() + 30 * 60 * 1000 + (existingEnd.getTime() - existingStart.getTime())).toISOString(),
          }
        }
      });
    }

    // Check for travel time conflicts
    // If events are back-to-back with different locations
    const timeBetween = Math.abs(newStart.getTime() - existingEnd.getTime()) / (1000 * 60);
    const travelTime = calculateTravelTime(newEvent.location, existing.location);

    if (timeBetween > 0 && timeBetween < travelTime && newEvent.location && existing.location) {
      conflicts.push({
        id: `travel-${newEvent.start}-${existing.id}`,
        type: 'travel',
        severity: 'medium',
        events: [newEvent.start, existing.id],
        message: `Only ${Math.round(timeBetween)} min between events, but ${travelTime} min travel time needed`,
        suggestion: travelTime > 20
          ? `Consider adding buffer time or rescheduling`
          : `Tight schedule - you'll need to travel quickly`,
        resolution: {
          type: 'reschedule',
          description: `Add ${travelTime - Math.round(timeBetween)} min buffer between events`,
          newTime: {
            start: new Date(existingEnd.getTime() + travelTime * 60 * 1000).toISOString(),
            end: new Date(newEnd.getTime() + travelTime * 60 * 1000).toISOString(),
          }
        }
      });
    }

    // Check for double-booking the same attendees
    if (newEvent.attendees && existing.attendees) {
      const newEmails = new Set(newEvent.attendees.map(a => a.email));
      const existingEmails = existing.attendees.map((a: any) => a.email);
      const overlapping = existingEmails.filter((email: string) => newEmails.has(email));

      if (overlapping.length > 0) {
        conflicts.push({
          id: `double-booked-${newEvent.start}-${existing.id}`,
          type: 'double_booked',
          severity: 'high',
          events: [newEvent.start, existing.id],
          message: `${overlapping.length} attendee(s) double-booked: ${overlapping.join(', ')}`,
          suggestion: overlapping.length === 1
            ? `${overlapping[0]} cannot attend both events`
            : `These attendees cannot attend both events`,
          resolution: {
            type: 'delegate',
            description: `Remove conflicting attendee or reschedule`
          }
        });
      }
    }
  }

  return conflicts;
}

/** Family `events` row (liveEvents shape: {title, date, time?: "4:00 PM"}) →
 *  the conflict engine's event shape. Timed rows get a 1-hour span (clamped at
 *  23:59 — never wrapping past midnight into an end-before-start row); rows
 *  without a parsable time become all-day rows centered at 12:00 with a
 *  one-minute duration, which only ever conflict on date equality. */
export function familyRowToConflictEvent(e: { id?: string | number; title: string; date: string; time?: string }): GoogleCalendarEvent {
  const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(e.time || "").trim());
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(String(e.time || "").trim());
  let h: number | null = null;
  let min = 0;
  if (m12) { h = Number(m12[1]) % 12; min = Number(m12[2]); if (m12[3].toUpperCase() === "PM") h += 12; }
  else if (m24) { h = Number(m24[1]); min = Number(m24[2]); }
  if (h === null) {
    return { id: `family_${e.id ?? e.title}`, summary: e.title, start: { dateTime: `${e.date}T12:00:00` }, end: { dateTime: `${e.date}T12:01:00` } } as unknown as GoogleCalendarEvent;
  }
  const startH = String(h).padStart(2, "0"), startM = String(min).padStart(2, "0");
  const endTotal = h * 60 + min + 60;
  // Clamp at 23:59 — a `% 24` wrap would put the end at 00:30 on the SAME
  // date string (end < start), so late-night events never conflicted.
  const endClamped = Math.min(endTotal, 23 * 60 + 59);
  const endH = String(Math.floor(endClamped / 60)).padStart(2, "0"), endM = String(endClamped % 60).padStart(2, "0");
  return {
    id: `family_${e.id ?? e.title}`, summary: e.title,
    start: { dateTime: `${e.date}T${startH}:${startM}:00` },
    end: { dateTime: `${e.date}T${endH}:${endM}:00` },
  } as unknown as GoogleCalendarEvent;
}

/**
 * Check if adding an event would create conflicts
 */
export async function wouldConflict(input: Omit<ConflictCheckInput, 'existingEvents'>, extraFamilyEvents: GoogleCalendarEvent[] = []): Promise<{
  hasConflict: boolean;
  conflicts: Conflict[];
  summary: string;
}> {
  // Fetch existing events
  const { readCachedEvents } = await import('./google/calendar.ts');
  const cachedEvents = await readCachedEvents();

  // Convert cached events to GoogleCalendarEvent format
  const existingEvents: GoogleCalendarEvent[] = [
    ...cachedEvents.map((e: any) => ({
      id: e.google_id,
      summary: e.summary,
      start: { dateTime: e.start_iso },
      end: { dateTime: e.end_iso },
      location: e.location,
      attendees: e.raw?.attendees || [],
    })),
    ...extraFamilyEvents,
  ];

  const conflicts = detectConflicts({
    ...input,
    existingEvents,
  });

  const highSeverity = conflicts.filter(c => c.severity === 'high');
  const mediumSeverity = conflicts.filter(c => c.severity === 'medium');

  let summary = '';
  if (highSeverity.length > 0) {
    summary = `⚠️ ${highSeverity.length} serious conflict(s) detected`;
  } else if (mediumSeverity.length > 0) {
    summary = `⚡ ${mediumSeverity.length} potential conflict(s)`;
  } else if (conflicts.length > 0) {
    summary = `ℹ️ ${conflicts.length} minor conflict(s)`;
  } else {
    summary = `✅ No conflicts detected`;
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
    summary,
  };
}

/**
 * Format conflict details for display
 */
export function formatConflictForDisplay(conflict: Conflict): string {
  const severityIcon = {
    low: 'ℹ️',
    medium: '⚡',
    high: '⚠️',
  }[conflict.severity];

  let text = `${severityIcon} ${conflict.message}`;

  if (conflict.suggestion) {
    text += `\n💡 ${conflict.suggestion}`;
  }

  if (conflict.resolution) {
    text += `\n🔧 ${conflict.resolution.description}`;
  }

  return text;
}
