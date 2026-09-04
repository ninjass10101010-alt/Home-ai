'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Square } from 'lucide-react';
import { VoiceInputButton } from '@/components/voice-input/VoiceInputButton';
import { PhotoInputButton } from '@/components/photo-input/PhotoInputButton';

interface UnifiedInputProps {
  onSendMessage: (message: string) => void;
  /** Fully disables the whole composer (rare — e.g. hard-locked states). */
  disabled?: boolean;
  /** Blocks only the send path; the user can keep drafting while Consuela thinks. */
  sendDisabled?: boolean;
  /** True while a reply is being generated — the send button becomes a stop control. */
  streaming?: boolean;
  onStop?: () => void;
  /** Prefills the composer (quick-action drafts). Remount via a changing key to apply. */
  initialValue?: string;
  showTip?: boolean;
}

export function UnifiedInput({
  onSendMessage,
  disabled,
  sendDisabled,
  streaming,
  onStop,
  initialValue,
  showTip = true,
}: UnifiedInputProps) {
  const [message, setMessage] = useState(initialValue ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = () => {
    if (!message.trim() || disabled || sendDisabled) return;
    onSendMessage(message);
    setMessage('');
  };

  const handleVoiceTranscript = (transcript: string) => {
    setMessage(transcript);
  };

  const handlePhotoExtracted = (text: string) => {
    setMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = !!message.trim() && !disabled && !sendDisabled;
  const showStop = !!streaming && !!onStop;

  return (
    <div className="border-t border-white/10 bg-[var(--color-surface-1)]/80 backdrop-blur-xl p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-end gap-3">
          {/* Voice Input */}
          <VoiceInputButton
            onTranscript={handleVoiceTranscript}
            disabled={disabled}
          />

          {/* Photo Input */}
          <PhotoInputButton
            onExtracted={handlePhotoExtracted}
            disabled={disabled}
          />

          {/* Text Input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message, or use voice/photo..."
              aria-label="Message Consuela"
              disabled={disabled}
              // Focus lands in the composer when a quick-action draft arrives
              // (the page remounts with a key) so the family can edit and send.
              autoFocus={Boolean(initialValue)}
              rows={1}
              className="w-full px-4 py-3 pr-12 rounded-2xl border border-white/10 bg-[var(--color-surface-2)] text-sm text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-[var(--color-accent-selected)]/60 focus:ring-2 focus:ring-[var(--color-accent-selected)]/25 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />

            {/* Send / Stop Button — stop replaces send while a reply streams */}
            <button
              onClick={showStop ? onStop : handleSubmit}
              disabled={showStop ? false : !canSend}
              aria-label={showStop ? 'Stop generating' : 'Send message'}
              title={showStop ? 'Stop generating' : 'Send message'}
              className={`absolute right-2 bottom-2 h-10 w-10 flex items-center justify-center rounded-full text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${
                showStop
                  ? 'bg-[var(--color-surface-3,#3a4256)] hover:brightness-110'
                  : 'bg-[var(--color-accent-button,var(--color-accent-selected))] hover:brightness-110'
              }`}
            >
              {showStop ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Help Text — a first-run hint, not a permanent resident */}
        {showTip && (
          <div className="mt-2 text-xs text-text-secondary text-center">
            💡 Tip: Say “Add dentist appointment tomorrow at 3pm” or snap a photo of a flyer
          </div>
        )}
      </div>
    </div>
  );
}
