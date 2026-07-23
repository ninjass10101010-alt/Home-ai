'use client';

import type { OutfitSuggestion as OutfitSuggestionType } from '@/db/features/morning-briefing';

interface OutfitSuggestionProps {
  suggestion: OutfitSuggestionType;
}

export function OutfitSuggestion({ suggestion }: OutfitSuggestionProps) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <span className="text-xl">{suggestion.emoji}</span>
        </div>
        <div className="space-y-2">
          <div>
            <h3 className="font-semibold text-foreground">Outfit Suggestion</h3>
            <p className="text-sm text-muted-foreground">{suggestion.suggestion}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestion.items.map((item, index) => (
              <span
                key={index}
                className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
