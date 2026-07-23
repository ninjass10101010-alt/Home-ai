'use client';

import { Quote } from 'lucide-react';
import type { DailyQuote as DailyQuoteType } from '@/db/features/morning-briefing';

interface DailyQuoteProps {
  quote: DailyQuoteType;
}

const categoryGradients = {
  motivational: 'from-purple-500/10 to-blue-500/10',
  funny: 'from-yellow-500/10 to-orange-500/10',
  family: 'from-pink-500/10 to-red-500/10',
  wisdom: 'from-green-500/10 to-teal-500/10',
  kids: 'from-blue-500/10 to-cyan-500/10',
  gratitude: 'from-amber-500/10 to-yellow-500/10',
};

export function DailyQuote({ quote }: DailyQuoteProps) {
  const gradient = categoryGradients[quote.category] || 'from-primary/10 to-primary/5';

  return (
    <div
      className={`rounded-xl border border-border/50 bg-gradient-to-br ${gradient} p-4`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Quote className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <blockquote className="text-sm italic leading-relaxed text-foreground">
            "{quote.text}"
          </blockquote>
          {quote.author && (
            <cite className="mt-2 block text-xs not-italic text-muted-foreground">
              — {quote.author}
            </cite>
          )}
        </div>
      </div>
    </div>
  );
}
