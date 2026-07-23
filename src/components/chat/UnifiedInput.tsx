'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Mic, Camera, Loader2 } from 'lucide-react';
import { VoiceInputButton } from '@/components/voice-input/VoiceInputButton';
import { PhotoInputButton } from '@/components/photo-input/PhotoInputButton';
import { ClarificationModal } from '@/components/clarification/ClarificationModal';

interface UnifiedInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

interface ClarificationRequest {
  id: string;
  message: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    value: any;
    isDefault?: boolean;
  }>;
  context: any;
  confidence: number;
}

export function UnifiedInput({ onSendMessage, disabled }: UnifiedInputProps) {
  const [message, setMessage] = useState('');
  const [clarification, setClarification] = useState<ClarificationRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = async () => {
    if (!message.trim() || isProcessing) return;

    setIsProcessing(true);

    try {
      // Send message to backend for processing
      const response = await fetch('/api/chat/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      const result = await response.json();

      if (result.clarification) {
        // Show clarification modal
        setClarification(result.clarification);
      } else {
        // Send the message
        onSendMessage(message);
        setMessage('');
      }
    } catch (error) {
      console.error('Failed to process message:', error);
      // Still send the message even if processing fails
      onSendMessage(message);
      setMessage('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVoiceTranscript = async (transcript: string) => {
    setMessage(transcript);
    // Optionally auto-submit or let user review
  };

  const handlePhotoExtracted = (text: string) => {
    setMessage(text);
    // Optionally auto-submit or let user review
  };

  const handleClarificationSelect = (option: any) => {
    setClarification(null);

    // Reconstruct message with clarification
    const context = clarification?.context;
    if (context) {
      // Build a more specific message based on clarification
      const newMessage = buildClarifiedMessage(context, option);
      setMessage(newMessage);
    }
  };

  const handleClarificationCancel = () => {
    setClarification(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-end gap-3">
            {/* Voice Input */}
            <VoiceInputButton
              onTranscript={handleVoiceTranscript}
              disabled={disabled || isProcessing}
            />

            {/* Photo Input */}
            <PhotoInputButton
              onExtracted={handlePhotoExtracted}
              disabled={disabled || isProcessing}
            />

            {/* Text Input */}
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message, or use voice/photo..."
                disabled={disabled || isProcessing}
                rows={1}
                className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ minHeight: '48px', maxHeight: '200px' }}
              />

              {/* Send Button */}
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || isProcessing}
                className="absolute right-2 bottom-2 h-9 w-9 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Send message"
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>

          {/* Help Text */}
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
            💡 Tip: Say "Add dentist appointment tomorrow at 3pm" or snap a photo of a flyer
          </div>
        </div>
      </div>

      {/* Clarification Modal */}
      {clarification && (
        <ClarificationModal
          request={clarification}
          onSelect={handleClarificationSelect}
          onCancel={handleClarificationCancel}
        />
      )}
    </>
  );
}

/**
 * Build a clarified message based on user's clarification choice
 */
function buildClarifiedMessage(context: any, option: any): string {
  const originalMessage = context.originalMessage || '';

  // If clarification was about a person
  if (option.value.type === 'name') {
    return `${originalMessage} (for ${option.label})`;
  }

  // If clarification was about time
  if (option.value.type === 'time') {
    return `${originalMessage} at ${option.label}`;
  }

  // If clarification was about location
  if (option.value.type === 'location') {
    return `${originalMessage} at ${option.label}`;
  }

  // If user chose to rephrase
  if (option.value.type === 'rephrase') {
    return '';
  }

  return originalMessage;
}
