'use client';

import { Calendar } from 'lucide-react';

interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  location?: string;
  attendees?: string[];
}

interface CalendarPreviewProps {
  events: CalendarEvent[];
}

export function CalendarPreview({ events }: CalendarPreviewProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold text-foreground">Today's Schedule</h3>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No events scheduled for today. Enjoy your free day! 🎉
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Today's Schedule</h3>
        </div>
        <span className="text-sm text-muted-foreground">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-2">
        {events.map((event) => (
          <div
            key={event.id}
            className="rounded-lg border border-border/30 bg-background/50 p-3 transition-colors hover:bg-background"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <h4 className="font-medium text-foreground">{event.title}</h4>
                {event.location && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    📍 {event.location}
                  </p>
                )}
              </div>
              <div className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {event.time}
              </div>
            </div>
            {event.attendees && event.attendees.length > 0 && (
              <div className="mt-2 flex items-center gap-1">
                <span className="text-xs text-muted-foreground">with</span>
                {event.attendees.slice(0, 3).map((attendee, index) => (
                  <span
                    key={index}
                    className="text-xs font-medium text-foreground"
                  >
                    {attendee}
                    {index < Math.min(event.attendees!.length, 3) - 1 && ','}
                  </span>
                ))}
                {event.attendees.length > 3 && (
                  <span className="text-xs text-muted-foreground">
                    +{event.attendees.length - 3} more
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
