'use client';

import { Bell } from 'lucide-react';

interface Reminder {
  id: string;
  title: string;
  time: string;
  priority: 'low' | 'medium' | 'high';
}

interface ReminderListProps {
  reminders: Reminder[];
}

export function ReminderList({ reminders }: ReminderListProps) {
  if (reminders.length === 0) {
    return null;
  }

  const priorityColors = {
    low: 'bg-blue-500',
    medium: 'bg-yellow-500',
    high: 'bg-red-500',
  };

  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Reminders</h3>
        </div>
        <span className="text-sm text-muted-foreground">
          {reminders.length} active
        </span>
      </div>
      <div className="space-y-2">
        {reminders.map((reminder) => (
          <div
            key={reminder.id}
            className="flex items-start gap-3 rounded-lg border border-border/30 bg-background/50 p-3"
          >
            <div
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${priorityColors[reminder.priority]}`}
            />
            <div className="flex-1">
              <h4 className="font-medium text-foreground">{reminder.title}</h4>
              {reminder.time && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {reminder.time}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
