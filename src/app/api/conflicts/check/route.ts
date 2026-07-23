/**
 * POST /api/conflicts/check
 * Check if an event would create scheduling conflicts
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/pb-auth';
import { detectConflicts, formatConflictForDisplay } from '@/lib/conflict-detection';
import { readCachedEvents } from '@/lib/google/calendar';
import type { GoogleCalendarEvent } from '@/lib/google/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { summary, start, end, location, attendees } = body;

    // Validate input
    if (!summary || !start || !end) {
      return NextResponse.json(
        { error: 'Missing required fields: summary, start, end' },
        { status: 400 }
      );
    }

    // Validate dates
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      );
    }

    if (endDate <= startDate) {
      return NextResponse.json(
        { error: 'End time must be after start time' },
        { status: 400 }
      );
    }

    // Fetch existing events
    const cachedEvents = await withAdmin(async (pb) => {
      const rows = await pb
        .collection('consuela_google_calendar_events')
        .getFullList({ requestKey: null, sort: 'start_iso' });
      return rows;
    });

    // Convert to GoogleCalendarEvent format
    const existingEvents: GoogleCalendarEvent[] = cachedEvents.map((e: any) => ({
      id: e.google_id,
      summary: e.summary,
      start: { dateTime: e.start_iso },
      end: { dateTime: e.end_iso },
      location: e.location,
      attendees: e.raw?.attendees || [],
    }));

    // Detect conflicts
    const newEvent = {
      summary,
      start,
      end,
      location,
      attendees,
    };

    const conflicts = detectConflicts({
      newEvent,
      existingEvents,
      travelTimeMinutes: 15,
    });

    // Format conflicts for display
    const formattedConflicts = conflicts.map(c => ({
      ...c,
      formatted: formatConflictForDisplay(c),
    }));

    // Calculate summary
    const highSeverity = conflicts.filter(c => c.severity === 'high');
    const mediumSeverity = conflicts.filter(c => c.severity === 'medium');

    let summary_text = '';
    if (highSeverity.length > 0) {
      summary_text = `⚠️ ${highSeverity.length} serious conflict${highSeverity.length > 1 ? 's' : ''} detected`;
    } else if (mediumSeverity.length > 0) {
      summary_text = `⚡ ${mediumSeverity.length} potential conflict${mediumSeverity.length > 1 ? 's' : ''}`;
    } else if (conflicts.length > 0) {
      summary_text = `ℹ️ ${conflicts.length} minor conflict${conflicts.length > 1 ? 's' : ''}`;
    } else {
      summary_text = '✅ No conflicts detected';
    }

    return NextResponse.json({
      success: true,
      hasConflict: conflicts.length > 0,
      conflicts: formattedConflicts,
      summary: summary_text,
      conflictCount: conflicts.length,
    });

  } catch (error) {
    console.error('Conflict check error:', error);
    return NextResponse.json(
      { error: 'Failed to check conflicts' },
      { status: 500 }
    );
  }
}
