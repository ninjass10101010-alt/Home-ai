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

  return (
    <div className="flex flex-col items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      <button
        onClick={handleClick}
        disabled={disabled || isProcessing}
        className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${
          isProcessing
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-primary hover:bg-primary/90'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title="Take photo or upload image"
      >
        {isProcessing ? (
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        ) : (
          <Camera className="h-6 w-6 text-white" />
        )}
      </button>

      {isProcessing && (
        <span className="text-xs text-gray-500">Extracting text...</span>
      )}

      {error && (
        <span className="text-xs text-red-500 text-center max-w-xs">{error}</span>
      )}

      {preview && (
        <div className="relative mt-2">
          <img
            src={preview}
            alt="Preview"
            className="h-24 w-24 object-cover rounded-lg border-2 border-gray-300"
          />
          <button
            onClick={clearPreview}
            className="absolute -top-2 -right-2 h-6 w-6 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
          >
            <X className="h-4 w-4 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
