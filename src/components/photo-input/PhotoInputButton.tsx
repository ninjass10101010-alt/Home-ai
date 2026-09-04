'use client';

import { useState, useRef } from 'react';
import { Camera, Loader2, X } from 'lucide-react';

interface PhotoInputButtonProps {
  onExtracted: (text: string) => void;
  disabled?: boolean;
}

export function PhotoInputButton({ onExtracted, disabled }: PhotoInputButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Process image
    await processImage(file);
  };

  const processImage = async (file: File) => {
    setIsProcessing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/photo/process', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        onExtracted(result.text);
      } else {
        setError(result.error || 'Failed to extract text from image');
      }
    } catch (err: any) {
      setError('Failed to process image');
      console.error('Photo processing error:', err);
    } finally {
      setIsProcessing(false);
      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const clearPreview = () => {
    setPreview(null);
    setError(null);
  };

  const status = isProcessing ? 'Extracting text…' : error ?? '';

  return (
    <div className="flex flex-col items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        aria-label="Photo to extract text from"
        className="hidden"
      />

      <button
        onClick={handleClick}
        disabled={disabled || isProcessing}
        aria-label="Take photo or upload image"
        title="Take photo or upload image"
        className={`tap-sm flex h-12 w-12 items-center justify-center rounded-full ${
          isProcessing
            ? 'bg-[var(--color-surface-3,#3a4256)] cursor-not-allowed'
            : 'bg-[var(--color-accent-button,var(--color-accent-selected))]'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isProcessing ? (
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        ) : (
          <Camera className="h-6 w-6 text-white" />
        )}
      </button>

      {/* Live region: extracting / error announce to screen readers */}
      <span role="status" aria-live="polite" className="sr-only">{status}</span>

      {isProcessing && (
        <span className="text-xs text-text-secondary">Extracting text…</span>
      )}

      {error && (
        <span className="text-xs text-[var(--color-accent-rose)] text-center max-w-xs">{error}</span>
      )}

      {preview && (
        <div className="relative mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data-URL preview */}
          <img
            src={preview}
            alt="Photo preview before sending"
            className="h-24 w-24 object-cover rounded-lg border border-white/10"
          />
          <button
            onClick={clearPreview}
            aria-label="Remove photo"
            title="Remove photo"
            className="tap-sm absolute -top-2 -right-2 h-6 w-6 rounded-full bg-[var(--color-accent-rose)] flex items-center justify-center before:absolute before:-inset-2.5 before:content-['']"
          >
            <X className="h-4 w-4 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
