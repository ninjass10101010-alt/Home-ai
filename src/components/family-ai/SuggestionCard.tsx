'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, Check } from 'lucide-react';
import { useState } from 'react';

interface SuggestionAction {
  label: string;
  type: 'accept' | 'dismiss' | 'snooze' | 'custom';
  isPrimary?: boolean;
}

interface SuggestionCardProps {
  title: string;
  message: string;
  emoji?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  actions: SuggestionAction[];
  onAction: (action: SuggestionAction) => void;
}

const priorityStyles = {
  low: 'border-border/50 bg-card',
  medium: 'border-primary/30 bg-primary/5',
  high: 'border-amber-500/30 bg-amber-500/5',
  urgent: 'border-red-500/30 bg-red-500/5',
};

const priorityIcons = {
  low: '💡',
  medium: '📌',
  high: '⚡',
  urgent: '🚨',
};

export function SuggestionCard({
  title,
  message,
  emoji = '💡',
  priority,
  actions,
  onAction,
}: SuggestionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className={`rounded-xl border-2 p-4 ${priorityStyles[priority]}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl shrink-0">{emoji}</span>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
        </div>
      </div>
      
      {actions.length > 0 && (
        <div className="flex gap-2 mt-3">
          {actions.map((action, index) => (
            <button
              key={index}
              onClick={() => onAction(action)}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                action.isPrimary
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'border border-border bg-background text-foreground hover:bg-muted'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
