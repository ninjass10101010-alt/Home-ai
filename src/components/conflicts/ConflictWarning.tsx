'use client';

import { AlertCircle, Calendar, Clock, MapPin, Users } from 'lucide-react';
import Surface from '@/components/ui/Surface';
import Button from '@/components/ui/Button';
import type { Conflict } from '@/lib/conflict-detection';

interface ConflictWarningProps {
  conflicts: Conflict[];
  onResolve?: (conflict: Conflict) => void;
  onDismiss?: (conflict: Conflict) => void;
}

export function ConflictWarning({ conflicts, onResolve, onDismiss }: ConflictWarningProps) {
  if (conflicts.length === 0) return null;

  const highSeverity = conflicts.filter(c => c.severity === 'high');
  const mediumSeverity = conflicts.filter(c => c.severity === 'medium');

  return (
    <div className="space-y-3">
      {highSeverity.length > 0 && (
        <Surface
          variant="flat"
          radius="lg"
          padding="md"
          className="border-2 border-[var(--color-accent-rose)]"
          style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)' }}
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 text-[var(--color-accent-rose)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-text-primary mb-2">
                ⚠️ {highSeverity.length} Serious Conflict{highSeverity.length > 1 ? 's' : ''} Detected
              </h3>
              <div className="space-y-2">
                {highSeverity.map((conflict) => (
                  <ConflictItem
                    key={conflict.id}
                    conflict={conflict}
                    onResolve={onResolve}
                    onDismiss={onDismiss}
                  />
                ))}
              </div>
            </div>
          </div>
        </Surface>
      )}

      {mediumSeverity.length > 0 && (
        <Surface
          variant="flat"
          radius="lg"
          padding="md"
          className="border border-[var(--color-accent-amber)]"
          style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)' }}
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-[var(--color-accent-amber)] shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-text-primary mb-2">
                ⚡ {mediumSeverity.length} Potential Conflict{mediumSeverity.length > 1 ? 's' : ''}
              </h3>
              <div className="space-y-2">
                {mediumSeverity.map((conflict) => (
                  <ConflictItem
                    key={conflict.id}
                    conflict={conflict}
                    onResolve={onResolve}
                    onDismiss={onDismiss}
                  />
                ))}
              </div>
            </div>
          </div>
        </Surface>
      )}
    </div>
  );
}

function ConflictItem({
  conflict,
  onResolve,
  onDismiss,
}: {
  conflict: Conflict;
  onResolve?: (conflict: Conflict) => void;
  onDismiss?: (conflict: Conflict) => void;
}) {
  const typeIcon = {
    overlap: <Clock className="h-4 w-4" />,
    travel: <MapPin className="h-4 w-4" />,
    resource: <Calendar className="h-4 w-4" />,
    double_booked: <Users className="h-4 w-4" />,
  }[conflict.type];

  return (
    <Surface variant="glass-strong" radius="lg" padding="sm" className="space-y-2">
      <div className="flex items-start gap-2">
        <div className="text-text-secondary shrink-0 mt-0.5">
          {typeIcon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary">
            {conflict.message}
          </p>
          {conflict.suggestion && (
            <p className="text-xs text-text-secondary mt-1">
              💡 {conflict.suggestion}
            </p>
          )}
          {conflict.resolution && (
            <Surface variant="flat" radius="md" padding="sm" className="mt-2">
              <p className="text-text-primary font-medium mb-1 text-xs">
                🔧 Suggested Resolution:
              </p>
              <p className="text-text-primary text-xs">
                {conflict.resolution.description}
              </p>
              {conflict.resolution.newTime && (
                <p className="text-text-secondary mt-1 text-xs">
                  New time: {new Date(conflict.resolution.newTime.start).toLocaleString()}
                </p>
              )}
            </Surface>
          )}
        </div>
      </div>

      {(onResolve || onDismiss) && (
        <div className="flex gap-2 pt-2 border-t border-border">
          {onResolve && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onResolve(conflict)}
              className="flex-1"
            >
              Resolve
            </Button>
          )}
          {onDismiss && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onDismiss(conflict)}
              className="flex-1"
            >
              Dismiss
            </Button>
          )}
        </div>
      )}
    </Surface>
  );
}
