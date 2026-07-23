'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Calendar, Users, Tag, Sparkles } from 'lucide-react';
import type { CreateCapsuleRequest } from '@/db/features/time-capsule';

interface CreateCapsuleFormProps {
  onClose: () => void;
  onSubmit: (data: CreateCapsuleRequest) => Promise<void>;
  familyMembers?: Array<{ id: string; name: string }>;
}

export function CreateCapsuleForm({
  onClose,
  onSubmit,
  familyMembers = [],
}: CreateCapsuleFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unlockDate, setUnlockDate] = useState('');
  const [unlockMessage, setUnlockMessage] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [isFamilyWide, setIsFamilyWide] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [currentTag, setCurrentTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    // Validation
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    
    if (!unlockDate) {
      setError('Unlock date is required');
      return;
    }
    
    // Check if unlock date is in the future
    const unlock = new Date(unlockDate);
    if (unlock <= new Date()) {
      setError('Unlock date must be in the future');
      return;
    }
    
    setLoading(true);
    
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        unlockDate,
        unlockMessage: unlockMessage.trim(),
        recipients: isFamilyWide ? [] : recipients,
        isFamilyWide,
        tags,
        color: '#3b82f6', // Default color
      });
      
      onClose();
    } catch (err) {
      setError('Failed to create time capsule');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  
  const handleAddTag = () => {
    if (currentTag.trim() && !tags.includes(currentTag.trim())) {
      setTags([...tags, currentTag.trim()]);
      setCurrentTag('');
    }
  };
  
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };
  
  // Get minimum date (tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];
  
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
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Create Time Capsule</h2>
              <p className="text-sm text-muted-foreground">
                Lock away memories for the future
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
          {/* Title */}
          <div>
            <label htmlFor="title" className="mb-2 block text-sm font-medium text-foreground">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Summer 2024 Memories"
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              maxLength={100}
              required
            />
          </div>
          
          {/* Description */}
          <div>
            <label htmlFor="description" className="mb-2 block text-sm font-medium text-foreground">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's inside this capsule?"
              className="w-full resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              rows={3}
              maxLength={500}
            />
          </div>
          
          {/* Unlock Date */}
          <div>
            <label htmlFor="unlockDate" className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Calendar className="h-4 w-4" />
              Unlock Date <span className="text-red-500">*</span>
            </label>
            <input
              id="unlockDate"
              type="date"
              value={unlockDate}
              onChange={(e) => setUnlockDate(e.target.value)}
              min={minDate}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Choose when this capsule should be unlocked
            </p>
          </div>
          
          {/* Recipients */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Users className="h-4 w-4" />
              Who can view this capsule?
            </label>
            
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              {/* Family-wide option */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFamilyWide}
                  onChange={(e) => {
                    setIsFamilyWide(e.target.checked);
                    if (e.target.checked) {
                      setRecipients([]);
                    }
                  }}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <div>
                  <div className="text-sm font-medium text-foreground">Entire family</div>
                  <div className="text-xs text-muted-foreground">
                    All family members can view and contribute
                  </div>
                </div>
              </label>
              
              {/* Individual recipients */}
              {!isFamilyWide && familyMembers.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Or select specific members:
                  </div>
                  {familyMembers.map((member) => (
                    <label
                      key={member.id}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={recipients.includes(member.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setRecipients([...recipients, member.id]);
                          } else {
                            setRecipients(recipients.filter((id) => id !== member.id));
                          }
                        }}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="text-sm text-foreground">{member.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Unlock Message */}
          <div>
            <label htmlFor="unlockMessage" className="mb-2 block text-sm font-medium text-foreground">
              Unlock Message
            </label>
            <textarea
              id="unlockMessage"
              value={unlockMessage}
              onChange={(e) => setUnlockMessage(e.target.value)}
              placeholder="A special message to show when the capsule is unlocked..."
              className="w-full resize-none rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              rows={2}
              maxLength={300}
            />
          </div>
          
          {/* Tags */}
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Tag className="h-4 w-4" />
              Tags
            </label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={currentTag}
                  onChange={(e) => setCurrentTag(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Add a tag..."
                  className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  maxLength={30}
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Add
                </button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-1 hover:text-primary/70"
                        aria-label={`Remove ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
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
              {loading ? 'Creating...' : 'Create Capsule'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
