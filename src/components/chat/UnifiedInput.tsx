'use client';

import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { VoiceInputButton } from '@/components/voice-input/VoiceInputButton';
import { PhotoInputButton } from '@/components/photo-input/PhotoInputButton';

interface UnifiedInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

export function UnifiedInput({ onSendMessage, disabled }: UnifiedInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = () => {
    if (!message.trim() || disabled) return;
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

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
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
              disabled={disabled}
              rows={1}
              className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />

            {/* Send Button */}
            <button
              onClick={handleSubmit}
              disabled={!message.trim() || disabled}
              aria-label="Send message"
              className="absolute right-2 bottom-2 h-10 w-10 flex items-center justify-center rounded-full bg-[var(--color-accent-button,var(--color-accent-selected))] hover:brightness-110 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
              title="Send message"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Help Text */}
        <div className="mt-2 text-xs text-text-secondary text-center">
          💡 Tip: Say “Add dentist appointment tomorrow at 3pm” or snap a photo of a flyer
        </div>
      </div>
    </div>
  );
}
