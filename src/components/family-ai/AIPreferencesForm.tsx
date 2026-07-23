'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Sparkles } from 'lucide-react';
import type { AIPreference } from '@/db/features/family-ai';

interface AIPreferencesFormProps {
  preferences: AIPreference | null;
  onSave: (data: Partial<AIPreference>) => Promise<void>;
}

export function AIPreferencesForm({ preferences, onSave }: AIPreferencesFormProps) {
  const [tone, setTone] = useState(preferences?.preferredTone || 'casual');
  const [emojiUsage, setEmojiUsage] = useState(preferences?.emojiUsage || 'moderate');
  const [responseLength, setResponseLength] = useState(preferences?.responseLength || 'moderate');
  const [suggestions, setSuggestions] = useState(preferences?.enableProactiveSuggestions ?? true);
  const [frequency, setFrequency] = useState(preferences?.suggestionFrequency || 'medium');
  const [customInstructions, setCustomInstructions] = useState(preferences?.customInstructions || '');
  const [saving, setSaving] = useState(false);
  
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        preferredTone: tone as any,
        emojiUsage: emojiUsage as any,
        responseLength: responseLength as any,
        enableProactiveSuggestions: suggestions,
        suggestionFrequency: frequency as any,
        customInstructions: customInstructions.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Consuela AI Preferences</h3>
      </div>
      
      {/* Tone */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Response Tone</label>
        <div className="grid grid-cols-4 gap-1.5">
          {(['casual', 'formal', 'playful', 'concise'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTone(t)}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-all ${
                tone === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      
      {/* Emoji Usage */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Emoji Usage</label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['minimal', 'moderate', 'frequent'] as const).map((e) => (
            <button
              key={e}
              onClick={() => setEmojiUsage(e)}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-all ${
                emojiUsage === e
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              {e === 'minimal' ? '🔹 Minimal' : e === 'moderate' ? '🔸 Moderate' : '🔶 Frequent'}
            </button>
          ))}
        </div>
      </div>
      
      {/* Response Length */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Response Length</label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['brief', 'moderate', 'detailed'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setResponseLength(l)}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize transition-all ${
                responseLength === l
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      
      {/* Proactive Suggestions */}
      <div className="rounded-lg bg-muted/30 p-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={suggestions}
            onChange={(e) => setSuggestions(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <div>
            <div className="text-xs font-medium text-foreground">Proactive Suggestions</div>
            <div className="text-[10px] text-muted-foreground">
              Consuela suggests helpful actions based on context
            </div>
          </div>
        </label>
        
        {suggestions && (
          <div className="mt-2 ml-7">
            <label className="text-[10px] text-muted-foreground">Frequency</label>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {(['low', 'medium', 'high'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFrequency(f)}
                  className={`rounded px-2 py-1 text-[10px] font-medium capitalize transition-all ${
                    frequency === f
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Custom Instructions */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Custom Instructions (optional)
        </label>
        <textarea
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          placeholder="e.g., Always suggest healthy meal options. Use sports analogies for Caspian."
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none resize-none"
          rows={2}
          maxLength={500}
        />
      </div>
      
      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  );
}
