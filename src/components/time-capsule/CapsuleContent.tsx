'use client';

import { motion } from 'framer-motion';
import { FileText, Image, Mic, Video } from 'lucide-react';
import type { CapsuleContent as CapsuleContentType } from '@/db/features/time-capsule';

interface CapsuleContentProps {
  content: CapsuleContentType;
}

export function CapsuleContent({ content }: CapsuleContentProps) {
  const getTypeIcon = () => {
    switch (content.type) {
      case 'text':
        return <FileText className="h-5 w-5 text-blue-500" />;
      case 'photo':
        return <Image className="h-5 w-5 text-green-500" />;
      case 'voice':
        return <Mic className="h-5 w-5 text-purple-500" />;
      case 'video':
        return <Video className="h-5 w-5 text-red-500" />;
    }
  };
  
  const getTypeLabel = () => {
    switch (content.type) {
      case 'text':
        return 'Text';
      case 'photo':
        return 'Photo';
      case 'voice':
        return 'Voice Recording';
      case 'video':
        return 'Video';
    }
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border bg-card p-4"
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          {getTypeIcon()}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {getTypeLabel()}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(content.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>
      </div>
      
      {/* Content */}
      {content.type === 'text' && (
        <div className="rounded-lg bg-muted/50 p-4">
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {content.data}
          </p>
        </div>
      )}
      
      {content.type === 'photo' && (
        <div className="overflow-hidden rounded-lg">
          <img
            src={content.data}
            alt={content.caption || 'Capsule photo'}
            className="w-full object-cover"
            onError={(e) => {
              e.currentTarget.src = '/placeholder-image.png';
            }}
          />
        </div>
      )}
      
      {content.type === 'voice' && (
        <div className="rounded-lg bg-muted/50 p-4">
          <audio controls className="w-full">
            <source src={content.data} />
            Your browser does not support the audio element.
          </audio>
        </div>
      )}
      
      {content.type === 'video' && (
        <div className="overflow-hidden rounded-lg">
          <video controls className="w-full">
            <source src={content.data} />
            Your browser does not support the video element.
          </video>
        </div>
      )}
      
      {/* Caption */}
      {content.caption && (
        <div className="mt-3 rounded-lg bg-primary/5 p-3">
          <p className="text-sm italic text-foreground">{content.caption}</p>
        </div>
      )}
    </motion.div>
  );
}
