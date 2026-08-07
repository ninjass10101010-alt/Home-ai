'use client';

import { motion } from 'framer-motion';
import { Lock, Unlock, Calendar, Users, Tag } from 'lucide-react';
import { CountdownTimer } from './CountdownTimer';
import type { TimeCapsule } from '@/db/features/time-capsule';
import { getCapsulePreview } from '@/lib/time-capsule';

interface TimeCapsuleCardProps {
  capsule: TimeCapsule;
  onClick?: () => void;
}

export function TimeCapsuleCard({ capsule, onClick }: TimeCapsuleCardProps) {
  const preview = getCapsulePreview(capsule);
  const isUnlocked = preview.isUnlocked;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border-2 cursor-pointer transition-all duration-200 ${
        isUnlocked
          ? 'border-green-500/50 bg-gradient-to-br from-green-500/10 to-emerald-500/10'
          : 'border-white/10 bg-[var(--color-surface-2)]/50 backdrop-blur-xl hover:border-white/20'
      }`}
    >
      {/* Hover glow effect */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />
      </div>
      
      {/* Header */}
      <div className="relative p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full ${
                isUnlocked ? 'bg-green-500/20' : 'bg-primary/10'
              }`}
            >
              {isUnlocked ? (
                <Unlock className="h-6 w-6 text-green-500" />
              ) : (
                <Lock className="h-6 w-6 text-primary" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{capsule.title}</h3>
              <p className="text-sm text-muted-foreground">
                {isUnlocked ? 'Unlocked!' : 'Locked'}
              </p>
            </div>
          </div>
          {isUnlocked && (
            <div className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-600">
              Ready to Open
            </div>
          )}
        </div>
        
        {/* Description */}
        {capsule.description && (
          <p className="mb-4 text-sm text-muted-foreground line-clamp-2">
            {capsule.description}
          </p>
        )}
        
        {/* Countdown or Unlock Date */}
        <div className="mb-4">
          {isUnlocked ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Unlocked on{' '}
                {new Date(capsule.unlockDate).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          ) : (
            <CountdownTimer unlockDate={capsule.unlockDate} />
          )}
        </div>
        
        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="font-medium text-foreground">{capsule.contentCount}</span>
            <span>item{capsule.contentCount !== 1 ? 's' : ''}</span>
          </div>
          
          {capsule.isFamilyWide && (
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              <span>Family</span>
            </div>
          )}
          
          {capsule.recipients.length > 0 && !capsule.isFamilyWide && (
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              <span>{capsule.recipients.length} recipient{capsule.recipients.length !== 1 ? 's' : ''}</span>
            </div>
          )}
          
          {capsule.tags && capsule.tags.length > 0 && (
            <div className="flex items-center gap-1">
              <Tag className="h-3 w-3" />
              <span>{capsule.tags.length} tag{capsule.tags.length !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
        
        {/* Tags */}
        {capsule.tags && capsule.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {capsule.tags.map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      
      {/* Decorative gradient */}
      {isUnlocked && (
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-green-500/5 to-emerald-500/5" />
      )}
    </motion.div>
  );
}
