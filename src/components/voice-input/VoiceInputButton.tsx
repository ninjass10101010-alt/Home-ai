'use client';

import { useState, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';

interface VoiceInputButtonProps {
  onTranscript: (transcript: string) => void;
  disabled?: boolean;
}

export function VoiceInputButton({ onTranscript, disabled }: VoiceInputButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      setError(null);

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Collect audio chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle recording complete
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudio(audioBlob);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      setError('Could not access microphone. Please check permissions.');
      console.error('Microphone error:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch('/api/voice/process', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        onTranscript(result.transcript);
      } else {
        setError(result.error || 'Failed to process audio');
      }
    } catch (err: any) {
      setError('Failed to process voice input');
      console.error('Voice processing error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleClick}
        disabled={disabled || isProcessing}
        className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
          isRecording
            ? 'bg-red-500 hover:bg-red-600 animate-pulse'
            : isProcessing
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-primary hover:bg-primary/90'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={isRecording ? 'Stop recording' : 'Start voice input'}
      >
        {isProcessing ? (
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        ) : isRecording ? (
          <MicOff className="h-6 w-6 text-white" />
        ) : (
          <Mic className="h-6 w-6 text-white" />
        )}
      </button>

      {isRecording && (
        <span className="text-xs text-red-500 font-medium">Recording...</span>
      )}

      {isProcessing && (
        <span className="text-xs text-gray-500">Processing...</span>
      )}

      {error && (
        <span className="text-xs text-red-500 text-center max-w-xs">{error}</span>
      )}
    </div>
  );
}
