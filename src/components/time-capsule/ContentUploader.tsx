'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, Image, FileText, Mic, Video, X } from 'lucide-react';
import type { ContentType } from '@/db/features/time-capsule';

interface ContentUploaderProps {
  onUpload: (type: ContentType, data: string, caption?: string) => Promise<void>;
  onClose: () => void;
}

export function ContentUploader({ onUpload, onClose }: ContentUploaderProps) {
  const [type, setType] = useState<ContentType>('text');
  const [data, setData] = useState('');
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!data.trim()) {
      setError('Content is required');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      await onUpload(type, data.trim(), caption.trim());
      onClose();
    } catch (err) {
      setError('Failed to upload content');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  
  const contentTypes: Array<{
    type: ContentType;
    label: string;
    icon: React.ReactNode;
    placeholder: string;
  }> = [
    {
      type: 'text',
      label: 'Text',
      icon: <FileText className="h-5 w-5" />,
      placeholder: 'Write your message, memory, or prediction...',
    },
    {
      type: 'photo',
      label: 'Photo URL',
      icon: <Image className="h-5 w-5" />,
      placeholder: 'https://example.com/photo.jpg',
    },
    {
      type: 'voice',
      label: 'Voice URL',
      icon: <Mic className="h-5 w-5" />,
      placeholder: 'https://example.com/recording.mp3',
    },
    {
      type: 'video',
      label: 'Video URL',
      icon: <Video className="h-5 w-5" />,
      placeholder: 'https://example.com/video.mp4',
    },
  ];
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Add Content</h2>
              <p className="text-sm text-muted-foreground">
                Add to this time capsule
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Content Type */}
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Content Type
            </label>
            <div className="grid grid-cols-4 gap-2">
              {contentTypes.map((ct) => (
                <button
                  key={ct.type}
                  type="button"
                  onClick={() => {
                    setType(ct.type);
                    setData('');
                  }}
                  className={`flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all ${
                    type === ct.type
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  {ct.icon}
                  <span className="text-xs font-medium">{ct.label}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Content Input */}
          <div>
            <label htmlFor="content" className="mb-2 block text-sm font-medium text-foreground">
              Content
            </label>
            {type === 'text' ? (
              <textarea
                id="content"
                value={data}
                onChange={(e) => setData(e.target.value)}
                placeholder={contentTypes.find((ct) => ct.type === type)?.placeholder}
                className="w-full resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                rows={6}
                required
              />
            ) : (
              <input
                id="content"
                type="url"
                value={data}
                onChange={(e) => setData(e.target.value)}
                placeholder={contentTypes.find((ct) => ct.type === type)?.placeholder}
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {type === 'text'
                ? 'Write your message or memory'
                : 'Paste the URL to your media file'}
            </p>
          </div>
          
          {/* Caption */}
          <div>
            <label htmlFor="caption" className="mb-2 block text-sm font-medium text-foreground">
              Caption (optional)
            </label>
            <input
              id="caption"
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption..."
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              maxLength={200}
            />
          </div>
          
          {/* Error */}
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
          
          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Uploading...' : 'Add Content'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
