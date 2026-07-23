'use client';

import { HelpCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import type { ClarificationRequest } from '@/lib/active-clarification';

interface ClarificationModalProps {
  request: ClarificationRequest;
  onSelect: (option: any) => void;
  onCancel: () => void;
}

export function ClarificationModal({ request, onSelect, onCancel }: ClarificationModalProps) {
  const groupedByType: Record<string, typeof request.options> = {};

  for (const option of request.options) {
    const type = option.value.type;
    if (!groupedByType[type]) groupedByType[type] = [];
    groupedByType[type].push(option);
  }

  const typeLabels: Record<string, { icon: string; label: string }> = {
    name: { icon: '👤', label: 'Who?' },
    time: { icon: '🕐', label: 'When?' },
    location: { icon: '📍', label: 'Where?' },
    action: { icon: '🎯', label: 'What?' },
    recurrence: { icon: '🔄', label: 'How often?' },
    rephrase: { icon: '✏️', label: 'Other' },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <Surface variant="glass-strong" radius="xl" className="max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <Surface
          variant="flat"
          radius="none"
          padding="lg"
          className="border-b border-border"
          style={{
            background: 'linear-gradient(to bottom right, rgba(59, 130, 246, 0.1), rgba(99, 102, 241, 0.1))',
          }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <HelpCircle className="h-8 w-8 text-[var(--color-accent-selected)]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                Need More Information
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                {request.message}
              </p>
            </div>
          </div>
        </Surface>

        {/* Options */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {Object.entries(groupedByType).map(([type, options]) => {
            const typeInfo = typeLabels[type] || { icon: '❓', label: type };

            return (
              <div key={type} className="space-y-2">
                <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                  <span>{typeInfo.icon}</span>
                  <span>{typeInfo.label}</span>
                </h3>
                <div className="space-y-2">
                  {options.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => onSelect(option.value)}
                      className={`w-full text-left p-3 rounded-lg border transition-all ${
                        option.isDefault
                          ? 'border-[var(--color-accent-selected)] bg-[var(--color-accent-selected)]/10 hover:bg-[var(--color-accent-selected)]/15'
                          : 'border-border bg-surface-1 hover:bg-surface-2'
                      }`}
                    >
                      <div className="font-medium text-sm text-text-primary">
                        {option.label}
                      </div>
                      {option.description && (
                        <div className="text-xs text-text-secondary mt-1">
                          {option.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <Surface variant="flat" radius="none" padding="md" className="border-t border-border">
          <Button variant="secondary" onClick={onCancel} className="w-full">
            Cancel
          </Button>
        </Surface>
      </Surface>
    </div>
  );
}
